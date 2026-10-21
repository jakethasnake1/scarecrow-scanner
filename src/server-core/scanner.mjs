import { isSolanaAddress } from './validation.mjs';
import { getMintAccount, getLargestTokenAccounts, getMarketPairs, searchSimilarTokens, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './sources.mjs';

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

export function gradeToken(onchain, market, concentration, assessment, coverage) {
  let score = 72;
  const reasons = [];
  const missing = [];
  if (!coverage.onchain || !onchain?.exists || !coverage.market || !market?.primaryPool) {
    return {
      score: null, grade: null, stance: 'UNRATED', reasons: ['Insufficient verified mint and DEX pair data to issue an infrastructure grade.'],
      unavailable: [!coverage.onchain || !onchain?.exists ? 'verified mint controls' : 'indexed DEX trading pair', '1D/3D/7D/30D history', 'bundle / insider %'],
      formula: 'No infrastructure grade is issued without verified on-chain mint data and an indexed trading pair.',
      partial: true,
    };
  }
  if (!coverage.onchain) {
    score -= 22;
    reasons.push('On-chain coverage incomplete.');
  }
  if (onchain?.exists === false) {
    score = 18;
    reasons.push('Address did not resolve to a valid SPL mint.');
  }
  if (onchain?.mintAuthority) {
    score -= 18;
    reasons.push('Mint authority remains active.');
  } else if (onchain?.exists) {
    score += 8;
    reasons.push('Mint authority appears revoked.');
  }
  if (onchain?.freezeAuthority) {
    score -= 12;
    reasons.push('Freeze authority remains active.');
  } else if (onchain?.exists) {
    score += 6;
    reasons.push('Freeze authority appears revoked.');
  }

  const elevatedCount = assessment.signals.filter((s) => s.severity === 'elevated').length;
  const attentionCount = assessment.signals.filter((s) => s.severity === 'attention').length;
  score -= Math.min(20, elevatedCount * 7);
  score -= Math.min(10, attentionCount * 3);

  const liquidity = market?.primaryPool?.liquidityUsd ?? null;
  if (liquidity !== null) {
    if (liquidity >= 100000) { score += 12; reasons.push('Strong indexed liquidity.'); }
    else if (liquidity >= 25000) { score += 8; reasons.push('Healthy indexed liquidity.'); }
    else if (liquidity >= 5000) { score += 3; reasons.push('Moderate indexed liquidity.'); }
    else { score -= 8; reasons.push('Thin indexed liquidity.'); }
  } else missing.push('liquidity depth');

  const volume24 = market?.primaryPool?.volume24hUsd ?? null;
  if (volume24 !== null) {
    if (volume24 >= 250000) { score += 10; reasons.push('Strong 24H trading activity.'); }
    else if (volume24 >= 50000) { score += 6; reasons.push('Solid 24H trading activity.'); }
    else if (volume24 >= 5000) { score += 2; reasons.push('Some measurable 24H trading activity.'); }
    else { score -= 6; reasons.push('Very light 24H trading activity.'); }
  } else missing.push('24H volume');

  const marketCap = market?.primaryPool?.marketCap ?? market?.primaryPool?.fdv ?? null;
  if (marketCap !== null) {
    if (marketCap >= 1000000) score += 4;
    else if (marketCap < 50000) score -= 3;
  } else missing.push('market cap');

  if ((market?.poolCount ?? 0) >= 3) {
    score += 4;
    reasons.push('Appears across multiple indexed pools.');
  }
  if ((market?.similar?.length ?? 0) >= 4) {
    score -= 4;
    reasons.push('Several similar-name listings found.');
  }
  if (concentration?.top10TokenAccountsPct != null) {
    if (concentration.top10TokenAccountsPct >= 90) { score -= 10; reasons.push('Top token accounts are highly concentrated.'); }
    else if (concentration.top10TokenAccountsPct >= 75) { score -= 5; reasons.push('Top token accounts hold a large share.'); }
  } else missing.push('distribution / holder concentration');

  missing.push('1D/3D/7D/30D trend windows', 'bundle / insider %');
  score = clamp(Math.round(score), 8, 98);
  const grade = letterGrade(score);
  let stance = 'CAUTION';
  if (score >= 88) stance = 'LEGIT LEAN';
  else if (score >= 72) stance = 'WATCHLIST';
  else if (score >= 55) stance = 'HIGH RISK';
  else stance = 'EXTREME RISK';

  return {
    score,
    grade,
    stance,
    partial: !coverage.largestAccounts || !coverage.similar,
    reasons: reasons.slice(0, 7),
    unavailable: [...new Set(missing)],
    formula: 'PROVISIONAL infrastructure indicator (not a safety certification). Starter grade built from on-chain authorities, Token-2022 controls, indexed liquidity, indexed volume, pool breadth, similar listings, and token-account concentration. It does not yet include insider %, bundle %, or full 1/3/7/30 day trend history.',
  };
}

export async function scan(mint, deps = {}) {
  if (!isSolanaAddress(mint)) throw Object.assign(new Error('Invalid Solana mint address'), { status: 400, code: 'invalid_mint' });
  const sources = {
    getMintAccount: deps.getMintAccount || getMintAccount,
    getLargestTokenAccounts: deps.getLargestTokenAccounts || getLargestTokenAccounts,
    getMarketPairs: deps.getMarketPairs || getMarketPairs,
    searchSimilarTokens: deps.searchSimilarTokens || searchSimilarTokens,
  };
  const results = await Promise.allSettled([sources.getMintAccount(mint), sources.getMarketPairs(mint)]);
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
  const assessment = classify(mint, onchain, market, largest, coverage);
  return {
    version: '0.2.0', chain: 'solana', mint, checkedAt: new Date().toISOString(),
    onchain, market, concentration: largest, coverage,
    assessment, categorization: categorize(onchain, market, assessment),
    grade: gradeToken(onchain, market, largest, assessment, coverage),
    sourceLinks: [solscan(mint), `https://dexscreener.com/solana/${mint}`],
  };
}
