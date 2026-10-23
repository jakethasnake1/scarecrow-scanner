import { isSolanaAddress } from './validation.mjs';
import { getMintAccount, getLargestTokenAccounts, getMarketPairs, searchSimilarTokens, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, getSolscanIntel, getGeckoIntel } from './sources.mjs';
import { interpretSolscanData, interpretGeckoData, tokenAgeMetrics, holderMetrics, validateVerifiedLocks } from './market-intel.mjs';

const solscan = (mint) => `https://solscan.io/token/${mint}`;
const normalize = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g,' ');
const safeNum = (v) => v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function interpretMint(account) {
  if (!account) return { exists: false, verified: true, reason: 'Mint address was not found on Solana mainnet.' };
  if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(account.owner)) {
    return { exists: false, verified: true, reason: 'The account exists but is not owned by an SPL token program.', ownerProgram: account.owner };
  }
  const parsed = account.data?.parsed;
  if (parsed?.type !== 'mint') return { exists: false, verified: true, reason: 'The address does not resolve to a parsed SPL mint account.' };
  const info = parsed.info ?? {};
  const extensions = Array.isArray(info.extensions) ? info.extensions.map(e => ({
    type: String(e.extension ?? 'unknown'),
    state: e.state ?? null,
  })) : [];
  return {
    exists: true,
    verified: true,
    program: account.owner === TOKEN_2022_PROGRAM ? 'Token-2022' : 'SPL Token',
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    supplyRaw: typeof info.supply === 'string' ? info.supply : String(info.supply ?? '0'),
    decimals: typeof info.decimals === 'number' ? info.decimals : null,
    extensions,
  };
}

function getTokenSide(pair, mint) {
  if (pair?.baseToken?.address === mint) return pair.baseToken;
  if (pair?.quoteToken?.address === mint) return pair.quoteToken;
  return null;
}

function classifySimilarCandidate(candidate, primaryStats) {
  const reasons = [];
  let dupScore = 0;
  const minSubstantialVolume = 5000;

  if (candidate.volume24hUsd !== null && candidate.volume24hUsd < minSubstantialVolume) {
    dupScore += 1;
    reasons.push('substantial trading volume not observed');
  }

  if (primaryStats.volume24hUsd && candidate.volume24hUsd !== null) {
    if (candidate.volume24hUsd < primaryStats.volume24hUsd * 0.2) {
      dupScore += 1;
      reasons.push('24H volume far below scanned token');
    }
    if (candidate.volume24hUsd > primaryStats.volume24hUsd * 1.15) {
      reasons.push('higher 24H volume than scanned token');
    }
  }

  if (primaryStats.marketCap && candidate.marketCap) {
    const gap = Math.abs(candidate.marketCap - primaryStats.marketCap) / primaryStats.marketCap;
    if (gap <= 0.15) {
      dupScore += 1;
      reasons.push('market cap is very similar to scanned token');
    }
  }

  if (candidate.liquidityUsd !== null && candidate.liquidityUsd < 5000) {
    dupScore += 1;
    reasons.push('thin indexed liquidity');
  }

  return {
    label: dupScore >= 2 ? 'POSSIBLE DUP' : 'NAME MATCH',
    reasons,
  };
}

export function analyzeMarket(mint, pairs, similarPairs = []) {
  const matching = pairs.filter(pair => getTokenSide(pair, mint));
  matching.sort((a,b) => Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
  const primary = matching[0] || null;
  const firstIndexedPairAt = matching.reduce((first, p) => { const n = safeNum(p?.pairCreatedAt); return n > 0 && (first === null || n < first) ? n : first; }, null);
  const token = primary ? getTokenSide(primary, mint) : null;
  const symbol = token?.symbol ?? null;
  const name = token?.name ?? null;
  const pool = primary ? {
    dex: String(primary.dexId || 'unknown'),
    url: typeof primary.url === 'string' && primary.url.startsWith('https://dexscreener.com/') ? primary.url : `https://dexscreener.com/solana/${mint}`,
    liquidityUsd: safeNum(primary?.liquidity?.usd),
    volume24hUsd: safeNum(primary?.volume?.h24),
    volume6hUsd: safeNum(primary?.volume?.h6),
    volume1hUsd: safeNum(primary?.volume?.h1),
    marketCap: safeNum(primary?.marketCap),
    fdv: safeNum(primary?.fdv),
    pairCreatedAt: safeNum(primary.pairCreatedAt),
    pairAddress: primary.pairAddress ?? null,
    txns24h: safeNum(primary?.txns?.h24?.buys) !== null || safeNum(primary?.txns?.h24?.sells) !== null
      ? { buys: safeNum(primary?.txns?.h24?.buys), sells: safeNum(primary?.txns?.h24?.sells) }
      : null,
  } : null;

  const primaryStats = {
    volume24hUsd: pool?.volume24hUsd ?? null,
    marketCap: pool?.marketCap ?? pool?.fdv ?? null,
  };

  const candidates = new Map();
  for (const p of similarPairs) {
    for (const t of [p.baseToken, p.quoteToken]) {
      if (!t?.address || t.address === mint || !isSolanaAddress(t.address)) continue;
      const sameSymbol = symbol && normalize(t.symbol) === normalize(symbol);
      const sameName = name && normalize(t.name) === normalize(name);
      if (!sameName && !sameSymbol) continue;
      const existing = candidates.get(t.address);
      const candidate = {
        mint: t.address,
        name: t.name ?? null,
        symbol: t.symbol ?? null,
        match: sameName && sameSymbol ? 'name_and_symbol' : sameName ? 'name' : 'symbol',
        liquidityUsd: safeNum(p?.liquidity?.usd),
        volume24hUsd: safeNum(p?.volume?.h24),
        marketCap: safeNum(p?.marketCap),
        fdv: safeNum(p?.fdv),
        sourceUrl: `https://dexscreener.com/solana/${t.address}`,
      };
      if (!existing || (candidate.volume24hUsd || candidate.liquidityUsd || 0) > (existing.volume24hUsd || existing.liquidityUsd || 0)) candidates.set(t.address, candidate);
    }
  }
  const similar = [...candidates.values()]
    .sort((a,b) => Number((b.volume24hUsd ?? 0) || (b.liquidityUsd ?? 0)) - Number((a.volume24hUsd ?? 0) || (a.liquidityUsd ?? 0)))
    .map((candidate) => ({ ...candidate, verdict: classifySimilarCandidate(candidate, primaryStats) }))
    .slice(0, 12);
  return {
    name,
    symbol,
    firstIndexedPairAt,
    poolCount: matching.length,
    primaryPool: pool,
    similar,
    duplicateCaveat: 'Duplicate labels are heuristic only. In this MVP, Scarecrow leans on indexed volume, liquidity, and market-cap similarity; it does not prove authenticity or fraud.',
  };
}

export function analyzeConcentration(mintAccount, accounts) {
  const raw = mintAccount.supplyRaw;
  let supply;
  try { supply = BigInt(raw); } catch { return null; }
  if (supply <= 0n || !Array.isArray(accounts)) return null;
  let top10 = 0n;
  for (const entry of accounts.slice(0,10)) {
    try { top10 += BigInt(entry.amount); } catch { /* ignore malformed upstream item */ }
  }
  return {
    top10TokenAccountsPct: Math.round(Number(top10 * 10000n / supply) / 100),
    accountCountReturned: accounts.length,
    caveat: 'Token accounts are NOT unique wallet owners; LP vaults, exchanges, and custodians can dominate this number. Not a holder-clustering analysis.',
  };
}

function makeSignal(id, severity, title, description, source, evidenceUrl) {
  return { id, severity, title, description, source, evidenceUrl };
}

export function classify(mint, onchain, market, concentration, coverage) {
  const signals = [];
  const onchainLink = solscan(mint);
  const add = (id, severity, title, description, source = 'onchain') =>
    signals.push(makeSignal(id, severity, title, description, source, source === 'onchain' ? onchainLink : `https://dexscreener.com/solana/${mint}`));
  if (onchain?.exists) {
    if (onchain.mintAuthority) add('mint_authority', 'elevated', 'Mint authority is active', 'An authorized signer may create additional supply. This is a capability, not proof it will be abused.');
    if (onchain.freezeAuthority) add('freeze_authority', 'elevated', 'Freeze authority is active', 'An authorized signer may freeze associated token accounts. Some legitimate tokens retain this capability.');
    for (const ext of onchain.extensions || []) {
      const type = normalize(ext.type).replace(/[^a-z]/g,'');
      if (type === 'permanentdelegate' && ext.state?.delegate) add('permanent_delegate', 'elevated', 'Permanent delegate configured', 'A permanent delegate can have authority over tokens held in user accounts. Review configuration and intended use.');
      if (type === 'transferhook' && ext.state?.programId) add('transfer_hook', 'attention', 'Custom transfer hook present', 'Transfers may invoke a separate program. Its instructions and governance need independent review.');
      if (type === 'nontransferable') add('non_transferable', 'elevated', 'Token is non-transferable', 'This asset may not function as a freely transferable token.');
      if (type === 'defaultaccountstate' && normalize(ext.state?.state) === 'frozen') add('default_frozen', 'elevated', 'New token accounts default to frozen', 'A token account may require an authority to thaw it before transfers.');
      if (type === 'transferfeeconfig') {
        const cfg = ext.state?.newerTransferFee ?? ext.state?.newerTransferFeeConfig ?? {};
        const bps = safeNum(cfg.transferFeeBasisPoints);
        if (bps !== null && bps > 500) add('transfer_fee_high', 'elevated', `Transfer fee configuration: ${bps / 100}%`, 'A high configured fee can materially affect transfers. Fees may change if the fee authority remains active.');
        else add('transfer_fee_present', 'attention', 'Token-2022 transfer fees configured', 'Check current rates, maximum fee and fee authority before transacting.');
      }
    }
  }
  if (market.primaryPool?.liquidityUsd !== null && market.primaryPool?.liquidityUsd !== undefined && market.primaryPool.liquidityUsd < 3000) {
    add('low_liquidity', 'attention', 'Low observed DEX liquidity', 'Largest indexed pool currently has less than $3,000 liquidity, which can increase slippage and exit difficulty.', 'market');
  }
  if (market.similar.length) {
    add('similar_names', 'information', `${market.similar.length} similarly named token(s) found`, 'Matching names or tickers may be legitimate. This does not establish impersonation or token duplication.', 'market');
  }
  if (concentration?.top10TokenAccountsPct >= 75) {
    add('top_accounts', 'information', 'Top token accounts hold a large share', 'This includes liquidity pools and custody accounts. Do not interpret as top-ten individual holders.', 'onchain');
  }
  const criticalDataMissing = !coverage.onchain || !onchain?.exists;
  return {
    level: criticalDataMissing ? 'incomplete' : signals.some(s => s.severity === 'elevated') ? 'elevated_indicators' :
      signals.some(s => s.severity === 'attention') ? 'review_recommended' : 'no_elevated_indicators_observed',
    signals,
    disclaimer: 'This is an informational screening of limited public data, not a safety certificate, financial advice, or a finding that any person committed fraud. No score can prove a token is safe or a duplicate.',
  };
}

export function categorize(onchain, market, assessment) {
  const labels = [];
  if (!onchain?.verified) labels.push('UNVERIFIED ONCHAIN DATA');
  else if (onchain.exists === false) labels.push('NOT A VALID SPL MINT');
  else labels.push(onchain.program === 'Token-2022' ? 'TOKEN-2022' : 'CLASSIC SPL TOKEN');
  if (onchain?.mintAuthority) labels.push('MINT AUTHORITY ACTIVE');
  if (onchain?.freezeAuthority) labels.push('FREEZE AUTHORITY ACTIVE');
  if (market?.similar?.length) labels.push('NAME / SYMBOL MATCHES');
  if (market?.primaryPool?.liquidityUsd != null && market.primaryPool.liquidityUsd < 3000) labels.push('THIN INDEXED LIQUIDITY');
  if (!market?.primaryPool) labels.push('NO INDEXED TRADING PAIR');
  if (assessment.level === 'incomplete') labels.push('INCOMPLETE CHECK');
  return { labels, explanation: 'Descriptive tags, not a verification, fraud accusation or guarantee.' };
}

function letterGrade(score) {
  const bands = [
    [97, 'A+'], [93, 'A'], [90, 'A-'],
    [87, 'B+'], [83, 'B'], [80, 'B-'],
    [77, 'C+'], [73, 'C'], [70, 'C-'],
    [67, 'D+'], [63, 'D'], [60, 'D-'],
    [0, 'F-'],
  ];
  return bands.find(([min]) => score >= min)?.[1] || 'F-';
}

export function gradeToken(onchain, market, concentration, assessment, coverage, holders = null, age = null, locks = null) {
  // An evidence-based grade is always attempted if at least one meaningful
  // observation exists. Missing feeds reduce confidence, not actual risk.
  const verifiedMint = coverage.onchain === true && onchain?.verified === true && onchain?.exists === true;
  const confirmedInvalid = coverage.onchain === true && onchain?.verified === true && onchain?.exists === false;
  const indexedPair = coverage.market === true && Boolean(market?.primaryPool);
  const pool = indexedPair ? market.primaryPool : null;
  const concentrationPresent = verifiedMint && coverage.largestAccounts === true && concentration?.top10TokenAccountsPct != null;
  const liquidityPresent = pool?.liquidityUsd != null;
  const volumePresent = pool?.volume24hUsd != null;
  const capPresent = pool?.marketCap != null || pool?.fdv != null;
  const coverageScore = clamp(
    (verifiedMint || confirmedInvalid ? 45 : 0) + (indexedPair ? 25 : 0) +
    (liquidityPresent ? 7 : 0) + (volumePresent ? 7 : 0) + (capPresent ? 3 : 0) +
    (concentrationPresent ? 8 : 0) + (coverage.similar && indexedPair ? 5 : 0) +
    (holders?.holders != null ? 4 : 0) + (age?.firstTradingAt != null ? 2 : 0),
    0, 100,
  );
  const confidence = coverageScore >= 85 ? 'HIGH' : coverageScore >= 60 ? 'MEDIUM' : coverageScore > 0 ? 'LOW' : 'NONE';
  const basis = verifiedMint && indexedPair ? 'ON-CHAIN + DEX' : verifiedMint ? 'ON-CHAIN ONLY' : indexedPair ? 'DEX ONLY' : 'NO VERIFIED FEED';
  const unavailable = [];
  if (!verifiedMint && !confirmedInvalid) unavailable.push('verified Solana mint controls (RPC missing or unavailable)');
  if (!indexedPair) unavailable.push('indexed DEX trading pair (not indexed or feed unavailable)');
  if (!liquidityPresent) unavailable.push('indexed liquidity depth');
  if (!volumePresent) unavailable.push('indexed 24H volume');
  if (!capPresent) unavailable.push('indexed market capitalization / FDV');
  if (!concentrationPresent) unavailable.push('top token-account concentration');
  if (!coverage.similar) unavailable.push('similar-name search coverage');
  if (holders?.holders == null) unavailable.push('token holder count (GeckoTerminal unavailable; optional SOLSCAN_API_KEY)');
  if (age?.createdAt == null) unavailable.push('token creation timestamp (Solscan metadata)');
  if (age?.firstTradingAt == null) unavailable.push('indexed first trading/listing timestamp');
  if (locks?.status !== 'verified') unavailable.push('on-chain verified Streamflow lock contracts and release schedule');
  unavailable.push('verified insider / bundled trading analysis', '3D / 7D / 30D historical performance');
  const common = {
    confidence,
    coverageScore,
    basis,
    partial: coverageScore < 100,
    unavailable,
    formula: 'V4 EVIDENCE-WEIGHTED infrastructure indicator. Grades use observed mint controls, DEX measurements, indexed age and indexed holder statistics (GeckoTerminal or Solscan). Missing measurements reduce confidence and limit the maximum grade; they are not treated as confirmed misconduct. This does NOT determine legitimacy, ownership, insider activity, or investment safety.',
  };
  if (confirmedInvalid) {
    return {
      ...common, score: 0, grade: 'F-', stance: 'NOT A TOKEN',
      reasons: [onchain.reason || 'This address is not a valid SPL token mint on the responding RPC.'],
    };
  }
  if (!verifiedMint && !indexedPair) {
    // Assigning an A-F letter with zero evidence would invent a result.
    return {
      ...common, score: null, grade: 'U', stance: 'FEEDS UNAVAILABLE',
      reasons: ['No verified SPL mint or indexed trading pair could be observed. Re-scan or configure SOLANA_RPC_URL / HELIUS_API_KEY on the server.'],
    };
  }

  let score = 62;
  const reasons = [];
  if (verifiedMint) {
    if (onchain.mintAuthority) { score -= 18; reasons.push('Mint authority is active (possible new supply).'); }
    else { score += 8; reasons.push('Mint authority is revoked.'); }
    if (onchain.freezeAuthority) { score -= 12; reasons.push('Freeze authority is active.'); }
    else { score += 6; reasons.push('Freeze authority is revoked.'); }
    const specialElevated = assessment.signals.filter(s => s.severity === 'elevated' &&
      !['mint_authority', 'freeze_authority'].includes(s.id));
    const specialAttention = assessment.signals.filter(s => s.severity === 'attention' && s.id !== 'low_liquidity');
    if (specialElevated.length) { score -= Math.min(24, specialElevated.length * 12); reasons.push(`${specialElevated.length} elevated Token-2022 / control warning(s).`); }
    if (specialAttention.length) { score -= Math.min(12, specialAttention.length * 4); reasons.push(`${specialAttention.length} additional smart-token warning(s).`); }
  } else {
    reasons.push('Only DEX measurements were available; mint and freeze controls remain unknown.');
  }

  if (pool) {
    const liquidity = pool.liquidityUsd;
    if (liquidity !== null) {
      if (liquidity >= 100000) { score += 12; reasons.push('Indexed liquidity is at least $100K.'); }
      else if (liquidity >= 25000) { score += 8; reasons.push('Indexed liquidity is at least $25K.'); }
      else if (liquidity >= 5000) { score += 3; reasons.push('Indexed liquidity is at least $5K.'); }
      else { score -= 8; reasons.push('Indexed liquidity below $5K can impair exits.'); }
    }
    const volume24 = pool.volume24hUsd;
    if (volume24 !== null) {
      if (volume24 >= 250000) { score += 10; reasons.push('Indexed 24H volume is at least $250K.'); }
      else if (volume24 >= 50000) { score += 6; reasons.push('Indexed 24H volume is at least $50K.'); }
      else if (volume24 >= 5000) { score += 2; reasons.push('Indexed 24H volume is at least $5K.'); }
      else { score -= 6; reasons.push('Indexed 24H volume is below $5K.'); }
    }
    const marketCap = pool.marketCap ?? pool.fdv;
    if (marketCap !== null) {
      if (marketCap >= 1000000) score += 4;
      else if (marketCap < 50000) score -= 3;
    }
    if (market.poolCount >= 3) { score += 4; reasons.push('Multiple indexed DEX pairs observed.'); }
    if (coverage.similar && market.similar.length >= 4) { score -= 4; reasons.push('Several similar-name listings found (not proof of impersonation).'); }
  } else {
    reasons.push('No indexed DEX pair was available; liquidity and activity cannot be assessed.');
  }
  if (concentrationPresent) {
    if (concentration.top10TokenAccountsPct >= 90) { score -= 10; reasons.push('Top token accounts hold at least 90% (includes LP and custody).'); }
    else if (concentration.top10TokenAccountsPct >= 75) { score -= 5; reasons.push('Top token accounts hold at least 75% (includes LP and custody).'); }
  }

  // Holder participation is useful context but cheap addresses, dusting, and exchange
  // custody can inflate counts. Weight is bounded and NEVER overrides verified risks.
  if (holders?.holders != null && indexedPair) {
    const count = holders.holders;
    if (count >= 500) { score += 6; reasons.push(`${count.toLocaleString('en-US')} observed holders (address-based, not persons).`); }
    else if (count >= 150) { score += 3; reasons.push(`${count.toLocaleString('en-US')} observed holder addresses.`); }
    else if (count >= 50) { score += 1; reasons.push(`${count.toLocaleString('en-US')} observed holder addresses.`); }
    // Only a secondary signal alongside nontrivial liquidity and market cap.
    if (count >= 100 && (pool?.liquidityUsd ?? 0) >= 10000 &&
      (holders.marketCapUsed ?? 0) >= 10000) {
      const density = holders.holdersPer100kCap;
      if (density >= 200) { score += 3; reasons.push('Broad address participation relative to observed market cap.'); }
      else if (density >= 100) { score += 2; reasons.push('Moderate address participation relative to observed market cap.'); }
      else if (density >= 50) { score += 1; reasons.push('Some address participation relative to observed market cap.'); }
    }
    if (holders.holderTop20Pct != null && holders.holderTop20Pct >= 75) {
      score -= 5; reasons.push('Solscan top 20 holder-address concentration is elevated (includes LP/custody).');
    }
  }
  if (age?.tradingDays != null && indexedPair) {
    if (age.tradingDays >= 90) { score += 4; reasons.push('At least 90 days since the observed indexed trading/listing date.'); }
    else if (age.tradingDays >= 30) { score += 3; reasons.push('At least 30 days since the observed indexed trading/listing date.'); }
    else if (age.tradingDays >= 7) { score += 1; reasons.push('At least 7 days since the observed indexed trading/listing date.'); }
  }
  if (locks?.status === 'verified' && locks.lockedAmount > 0 && verifiedMint) {
    score += 4; reasons.push('Noncancelable Streamflow contract(s) independently verified with a future unlock date.');
  }
  // A market-only or chain-only result should not imply the token was fully screened.
  score = clamp(Math.round(score), 8, verifiedMint && indexedPair ? 98 : 77);
  const grade = letterGrade(score);
  const stance = score >= 88 ? 'FAVORABLE SIGNALS' : score >= 72 ? 'MONITOR' : score >= 55 ? 'CAUTION' : 'ELEVATED RISK SIGNALS';
  if (!verifiedMint || !indexedPair) reasons.push('One primary data source is missing; confidence is limited and the grade is capped at C+.');
  return { ...common, score, grade, stance, reasons };
}

export async function scan(mint, deps = {}) {
  if (!isSolanaAddress(mint)) throw Object.assign(new Error('Invalid Solana mint address'), { status: 400, code: 'invalid_mint' });
  const sources = {
    getMintAccount: deps.getMintAccount || getMintAccount,
    getLargestTokenAccounts: deps.getLargestTokenAccounts || getLargestTokenAccounts,
    getMarketPairs: deps.getMarketPairs || getMarketPairs,
    searchSimilarTokens: deps.searchSimilarTokens || searchSimilarTokens,
    getSolscanIntel: deps.getSolscanIntel || getSolscanIntel,
    getGeckoIntel: deps.getGeckoIntel || (deps.getMarketPairs ? async () => null : getGeckoIntel),
    getVerifiedStreamflowLocks: deps.getVerifiedStreamflowLocks || (async () => null),
  };
  const results = await Promise.allSettled([sources.getMintAccount(mint), sources.getMarketPairs(mint), sources.getSolscanIntel(mint), sources.getVerifiedStreamflowLocks(mint), sources.getGeckoIntel(mint)]);
  const account = results[0].status === 'fulfilled' ? results[0].value : null;
  const pairs = results[1].status === 'fulfilled' ? results[1].value : [];
  const onchain = results[0].status === 'fulfilled' ? interpretMint(account) : { exists: null, verified: false, reason: 'Solana RPC is currently unavailable.' };
  let market = analyzeMarket(mint, pairs);
  const coverage = { onchain: results[0].status === 'fulfilled', market: results[1].status === 'fulfilled', similar: false, largestAccounts: false };
  let largest = null;
  const tasks = [];
  if (coverage.market && market.symbol) tasks.push(sources.searchSimilarTokens(market.symbol)); else tasks.push(Promise.resolve([]));
  if (onchain.exists) tasks.push(sources.getLargestTokenAccounts(mint)); else tasks.push(Promise.resolve(null));
  const extras = await Promise.allSettled(tasks);
  if (extras[0].status === 'fulfilled') {
    coverage.similar = coverage.market && !!market.symbol;
    market = analyzeMarket(mint, pairs, extras[0].value);
  }
  if (extras[1].status === 'fulfilled' && Array.isArray(extras[1].value)) {
    coverage.largestAccounts = onchain.exists === true;
    largest = analyzeConcentration(onchain, extras[1].value);
  }
  const solscanIntel = results[2].status === 'fulfilled' && results[2].value
    ? interpretSolscanData(results[2].value.profile, results[2].value.statistics) : null;
  const geckoIntel = results[4].status === 'fulfilled' && results[4].value ? interpretGeckoData(results[4].value) : null;
  const holders = holderMetrics(solscanIntel, market, geckoIntel);
  const age = tokenAgeMetrics(market, solscanIntel);
  const locks = validateVerifiedLocks(results[3].status === 'fulfilled' ? results[3].value : null, mint);
  coverage.holders = holders.holders !== null;
  coverage.age = age.firstTradingAt !== null;
  coverage.streamflow = locks.status === 'verified';
  const assessment = classify(mint, onchain, market, largest, coverage);
  return {
    version: '4.0.0', chain: 'solana', mint, checkedAt: new Date().toISOString(),
    onchain, market, concentration: largest, holders, age, locks, coverage,
    assessment, categorization: categorize(onchain, market, assessment),
    grade: gradeToken(onchain, market, largest, assessment, coverage, holders, age, locks),
    sourceLinks: [solscan(mint), `https://dexscreener.com/solana/${mint}`, `https://www.geckoterminal.com/solana/tokens/${mint}`, 'https://app.streamflow.finance/'],
  };
}
