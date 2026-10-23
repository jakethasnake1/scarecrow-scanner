import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarket, scan } from '../src/server-core/scanner.mjs';
import { holderMetrics, interpretGeckoData, interpretSolscanData, tokenAgeMetrics, validateVerifiedLocks, interpretRugcheckData } from '../src/server-core/market-intel.mjs';
const mint = 'GtV6g1ey2NERrcbvL5bdzrxRJQDfxpMaLU9oLtRipump';
const quote = 'So11111111111111111111111111111111111111112';
const pair = (ms, cap = 150000) => ({ chainId:'solana', dexId:'raydium', baseToken:{address:mint,name:'CROW',symbol:'CROW'}, quoteToken:{address:quote, name:'SOL',symbol:'SOL'}, pairCreatedAt: ms, liquidity:{usd:33000}, volume:{h24:3100}, marketCap:cap });
test('earliest indexed pair timestamp is separate from primary liquidity pair', () => {
  const t1=Date.UTC(2026,8,4),t2=Date.UTC(2026,9,10);
  const market=analyzeMarket(mint,[pair(t2),{...pair(t1),liquidity:{usd:100}}]);
  assert.equal(market.firstIndexedPairAt, t1);
  assert.equal(market.primaryPool.pairCreatedAt,t2);
});
test('Solscan parses token creation, holder concentration and first listing correctly',()=>{
  const s=interpretSolscanData({data:{holder:800,created_time:1790800000}},{data:{num_holder:830,first_listing_time:1790810000,holder_top_20_balance_pct:31}});
  assert.equal(s.holders,830);
  assert.equal(s.holderTop20Pct,31);
  assert.equal(s.firstTradingAt,1790810000*1000);
});
test('free GeckoTerminal holder fallback and ratio are correctly calculated from MARKET CAP, not FDV',()=>{
  const gecko=interpretGeckoData({holders:{count:600,distribution_percentage:{top_10:'21.4'}}});
  assert.equal(gecko.holders,600);
  const h=holderMetrics(null,{primaryPool:{marketCap:150000,fdv:1000000}},gecko);
  assert.equal(h.marketCapPerHolder,250);
  assert.equal(h.holdersPer100kCap,400);
  assert.equal(h.holderTop10Pct,21.4);
  assert.equal(h.source,'GeckoTerminal (public)');
});
test('cannot mislabel FDV/holder as market cap/holder, cannot infer holder data from an empty feed',()=>{
  const h=holderMetrics(null,{primaryPool:{marketCap:null,fdv:500000}},interpretGeckoData({holders:{count:600}}));
  assert.equal(h.marketCapPerHolder,null);
  assert.equal(h.holdersPer100kCap,null);
});
test('trading age uses indexed first listing, and missing creation date stays unavailable',()=>{
  const now=Date.UTC(2026,9,22),first=now-35*86400000;
  const result=tokenAgeMetrics({firstIndexedPairAt:first},null,now);
  assert.equal(result.tradingDays,35);
  assert.equal(result.ageDays,null);
});
test('plain address label and claimed Streamflow locks never become verified automatically',()=>{
  const fake=[{source:'claimed_streamflow',mint,verifiedBy:'user',lockedAmount:1000000,unlockAt:Date.UTC(2027,0,1),contract:quote}];
  assert.equal(validateVerifiedLocks(fake,mint).status,'not_verified');
  assert.equal(validateVerifiedLocks(null,mint).status,'not_verified');
});
test('holder count and indexed age improve bounded provisional grade but do not bypass missing-mint cap',async()=>{
  const now=Date.now();
  const deps={getMintAccount:async()=>{throw Error('rpc offline')},getMarketPairs:async()=>[pair(now-60*86400000)],searchSimilarTokens:async()=>[],getLargestTokenAccounts:async()=>[],getGeckoIntel:async()=>null,getSolscanIntel:async()=>null};
  const base=await scan(mint,deps);
  const withHolder=await scan(mint,{...deps,getGeckoIntel:async()=>({holders:{count:600}})});
  assert.ok(withHolder.grade.score>base.grade.score);
  assert.ok(withHolder.grade.score<=77);
  assert.equal(withHolder.grade.basis,'DEX ONLY');
  assert.equal(withHolder.holders.holders,600);
  assert.equal(withHolder.age.tradingDays,60);
  assert.equal(withHolder.locks.status,'not_verified');
});

test('RugCheck indexed count and authority status are scoped to the exact mint', () => {
  const ok = interpretRugcheckData({ mint, totalHolders: 670, mintAuthority: null, freezeAuthority: null, detectedAt: '2026-10-02T14:00:00Z' }, mint);
  assert.equal(ok.holders, 670);
  assert.equal(ok.controlsAvailable, true);
  assert.equal(interpretRugcheckData({ mint: quote, totalHolders: 100000 }, mint), null);
  assert.equal(interpretRugcheckData({ mint, totalHolders: 100 }, mint).controlsAvailable, false);
});
test('RugCheck indexed holder counts can support a bounded C+ without direct RPC, never certifying locks', async () => {
  const data = { mint, totalHolders: 670, mintAuthority: null, freezeAuthority: null, detectedAt: '2026-10-02T14:00:00Z' };
  const deps = { getMintAccount: async () => { throw Error('rate limit'); }, getMarketPairs: async () => [pair(Date.now()-21*86400000)],
    searchSimilarTokens: async () => [], getSolscanIntel: async () => null, getGeckoIntel: async () => null, getRugcheckIntel: async () => data };
  const result = await scan(mint,deps);
  assert.equal(result.holders.holders,670);
  assert.equal(result.holders.source,'RugCheck (indexed)');
  assert.equal(result.grade.grade,'C+');
  assert.equal(result.grade.confidence,'LOW');
  assert.ok(result.grade.score <=77);
  assert.equal(result.sourceHealth.solanaRPC,'UNAVAILABLE');
  assert.equal(result.indexedControls.mintAuthority,null);
  assert.equal(result.onchain.verified,false);
  assert.equal(result.locks.status,'not_verified');
  assert.equal(result.age.ageDays,null);
  assert.ok(result.age.observedDays >= 0);
});
test('Third-party indexed active authorities reduce score, and cannot override verified RPC',async()=>{
  const deps={getMintAccount:async()=>{throw Error('timeout')},getMarketPairs:async()=>[pair(Date.now()-21*86400000)],
    searchSimilarTokens:async()=>[],getSolscanIntel:async()=>null,getGeckoIntel:async()=>null,
    getRugcheckIntel:async()=>({mint,totalHolders:200,mintAuthority:null,freezeAuthority:null})};
  const positive=await scan(mint,deps);
  const flagged=await scan(mint,{...deps,getRugcheckIntel:async()=>({mint,totalHolders:200,mintAuthority:quote,freezeAuthority:quote})});
  assert.ok(positive.grade.score > flagged.grade.score);
  assert.equal(flagged.grade.confidence,'LOW');
});

test('relative liquidity rewards modest market depth for ALL eligible tokens, not a special mint', async()=>{
  const other='CbQEShoNUwmTwYY5HDxmKLWNARUMJoSTpTJThSVEPUMP';
  const deps={getMintAccount:async()=>{throw Error('no rpc')},getMarketPairs:async(m)=>[
    { ...pair(Date.now()-21*86400000),baseToken:{address:m,name:'OTHER',symbol:'OTH'},liquidity:{usd:33593},marketCap:153198 }],
    searchSimilarTokens:async()=>[],getGeckoIntel:async()=>null,getSolscanIntel:async()=>null,getRugcheckIntel:async(m)=>({mint:m,totalHolders:150,mintAuthority:null,freezeAuthority:null})};
  const crow=await scan(mint,deps);
  const otherCoin=await scan(other,deps);
  assert.equal(crow.grade.grade, otherCoin.grade.grade);
  assert.ok(crow.grade.score>=73);
});
