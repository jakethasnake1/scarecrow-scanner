import test from 'node:test';
import assert from 'node:assert/strict';
import { isSolanaAddress, validEvidenceUrl } from '../src/server-core/validation.mjs';
import { scan, analyzeMarket, interpretMint, classify, analyzeConcentration, categorize } from '../src/server-core/scanner.mjs';

const MINT='GtV6g1ey2NERrcbvL5bdzrxRJQDfxpMaLU9oLtRipump';
const OTHER='So11111111111111111111111111111111111111112';
const SPL='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

test('valid Solana base58 public keys only, not random text',()=>{
 assert.equal(isSolanaAddress(MINT),true);
 assert.equal(isSolanaAddress(OTHER),true);
 assert.equal(isSolanaAddress('Invalid!!'),false);
 assert.equal(isSolanaAddress('12345'),false);
 assert.equal(isSolanaAddress('0'.repeat(40)),false);
});
test('allow HTTPS evidence, disallow scripts and local links',()=>{
 assert.equal(validEvidenceUrl('https://solscan.io/tx/ABC'),true);
 assert.equal(validEvidenceUrl('javascript:alert(1)'),false);
 assert.equal(validEvidenceUrl('http://localhost/'),false);
});
test('onchain mint authority is flagged and metadata is not assumed',()=>{
 const state=interpretMint({owner:SPL,data:{parsed:{type:'mint',info:{mintAuthority:OTHER,freezeAuthority:null,decimals:6,supply:'1000000000'}}}});
 assert.equal(state.exists,true);
 assert.equal(state.mintAuthority,OTHER);
 const market=analyzeMarket(MINT,[]);
 const result=classify(MINT,state,market,null,{onchain:true,market:true});
 assert.equal(result.level,'elevated_indicators');
 assert.ok(result.signals.some(x=>x.id==='mint_authority'));
});
test('Token-2022 transferHook & delegate emit evidence-backed indicators',()=>{
 const state=interpretMint({owner:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',data:{parsed:{type:'mint',info:{mintAuthority:null,freezeAuthority:null,decimals:9,supply:'10000',extensions:[{extension:'permanentDelegate',state:{delegate:OTHER}},{extension:'transferHook',state:{programId:OTHER}}]}}}});
 const assessment=classify(MINT,state,analyzeMarket(MINT,[]),null,{});
 assert.ok(assessment.signals.find(s=>s.id==='permanent_delegate'));
 assert.ok(assessment.signals.find(s=>s.id==='transfer_hook'));
});
test('duplicate candidates are merely matches, not fraud verdicts',()=>{
 const pair={chainId:'solana',dexId:'raydium',baseToken:{address:MINT,name:'Crow',symbol:'CROW'},quoteToken:{address:OTHER,name:'Wrapped SOL',symbol:'SOL'},liquidity:{usd:12000},url:'https://dexscreener.com/solana/example'};
 const alternative={chainId:'solana',baseToken:{address:OTHER,name:'Crow',symbol:'CROW'},quoteToken:{address:MINT,name:'Another',symbol:'SOL'},liquidity:{usd:4000}};
 const market=analyzeMarket(MINT,[pair],[alternative]);
 assert.equal(market.similar.length,1);
 assert.equal(market.similar[0].match,'name_and_symbol');
 const assessment=classify(MINT,{exists:true,extensions:[]},market,null,{});
 assert.equal(assessment.signals.find(s=>s.id==='similar_names').severity,'information');
});
test('partial RPC outage never displays no-risk verdict',async()=>{
 const result=await scan(MINT,{getMintAccount:async()=>{throw Error('RPC unavailable');},getMarketPairs:async()=>[],searchSimilarTokens:async()=>[],getLargestTokenAccounts:async()=>[]});
 assert.equal(result.coverage.onchain,false);
 assert.equal(result.assessment.level,'incomplete');
});
test('concentration references token accounts, not persons',()=>{
 const s=analyzeConcentration({supplyRaw:'1000'},[{amount:'750'},{amount:'50'}]);
 assert.equal(s.top10TokenAccountsPct,80);
 assert.match(s.caveat,/NOT unique wallet owners/);
});

test('categorization labels are descriptive and are not scam conclusions',()=>{
 const s = categorize({verified:true,exists:true,program:'SPL Token',mintAuthority:OTHER},{similar:[{mint:OTHER}],primaryPool:null},{level:'elevated_indicators'});
 assert.ok(s.labels.includes('MINT AUTHORITY ACTIVE'));
 assert.ok(s.labels.includes('NAME / SYMBOL MATCHES'));
 assert.doesNotMatch(s.labels.join(' '),/SCAM|FRAUD/);
});

test('does not issue A-to-F grade when an RPC outage leaves onchain data unavailable', async () => {
 const r = await scan(MINT, {
   getMintAccount: async () => { throw Error('RPC down'); },
   getMarketPairs: async () => [],
   searchSimilarTokens: async () => [],
   getLargestTokenAccounts: async () => [],
 });
 assert.equal(r.grade.grade, null);
 assert.equal(r.grade.score, null);
 assert.equal(r.grade.stance, 'UNRATED');
});

test('does not issue an infrastructure grade without a DEX trading pair', async () => {
 const r = await scan(MINT, {
   getMintAccount: async () => ({ owner: SPL, data: { parsed: { type:'mint', info: { mintAuthority: null, freezeAuthority: null, supply: '100000000', decimals: 6 } } } }),
   getMarketPairs: async () => [],
   searchSimilarTokens: async () => [],
   getLargestTokenAccounts: async () => [{amount:'10000000'}],
 });
 assert.equal(r.grade.grade, null);
});

test('issues provisional infrastructure grade when mint and market data exist', async () => {
 const pair = {
   chainId:'solana', dexId:'raydium', pairAddress:OTHER,
   baseToken:{address:MINT,name:'CROW',symbol:'CROW'}, quoteToken:{address:OTHER, name:'Wrapped SOL', symbol:'SOL'},
   liquidity:{usd:50000}, volume:{h24:120000,h6:45000,h1:12000}, marketCap:500000,
 };
 const r = await scan(MINT, {
   getMintAccount: async () => ({ owner:SPL, data:{ parsed:{ type:'mint', info:{mintAuthority:null,freezeAuthority:null,supply:'100000000',decimals:6} } } }),
   getMarketPairs: async () => [pair],
   searchSimilarTokens: async () => [],
   getLargestTokenAccounts: async () => [{amount:'10000000'}],
 });
 assert.ok(r.grade.score > 0);
 assert.ok(r.grade.grade);
 assert.equal(r.market.primaryPool.volume1hUsd,12000);
 assert.equal(r.market.primaryPool.volume6hUsd,45000);
});
