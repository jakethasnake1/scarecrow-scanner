// Server-only normalization of independently sourced holder and age observations.
// A holding address is not necessarily a unique person; never turn density into a safety certificate.
const number = (value) => value === '' || value == null ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const positiveInteger = (value) => { const n = number(value); return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null; };
export const epochSeconds = (value) => {
  const n = number(value);
  if (n === null || n <= 0) return null;
  const ms = n < 100000000000 ? n * 1000 : n;
  return ms >= Date.UTC(2020, 0, 1) && ms <= Date.now() + 86400000 ? ms : null;
};

export function interpretSolscanData(profile, stats, holderList = null) {
  const p = profile?.data ?? profile ?? {};
  const s = stats?.data ?? stats ?? {};
  const holders = positiveInteger(holderList?.data?.total ?? holderList?.total) ?? positiveInteger(s.num_holder) ?? positiveInteger(p.holder);
  return {
    holders,
    holderSource: holders === null ? null : 'Solscan Pro API',
    createdAt: epochSeconds(p.created_time) ?? epochSeconds(p.first_mint_time),
    tokenAgeSource: epochSeconds(p.created_time) ? 'Solscan token creation' : epochSeconds(p.first_mint_time) ? 'Solscan first mint' : null,
    firstTradingAt: epochSeconds(s.first_listing_time),
    firstTradingSource: epochSeconds(s.first_listing_time) ? 'Solscan first listing (indexed)' : null,
    holderGini: number(s.holder_gini),
    holderTop20Pct: number(s.holder_top_20_balance_pct),
    holderTop1Pct: number(s.holder_top_1_balance_pct),
    holderHhi: number(s.holder_hhi),
  };
}

export function interpretGeckoData(data) {
  const count = positiveInteger(data?.holders?.count);
  const top10 = number(data?.holders?.distribution_percentage?.top_10);
  return {
    holders: count,
    holderSource: count === null ? null : 'GeckoTerminal (public)',
    holderTop10Pct: top10 !== null && top10 >= 0 && top10 <= 100 ? top10 : null,
    lastUpdated: typeof data?.holders?.last_updated === 'string' ? data.holders.last_updated : null,
  };
}

export function interpretRugcheckData(data, mint) {
  if (!data || data.mint !== mint) return null;
  const holders = positiveInteger(data.totalHolders);
  const hasMintAuthority = Object.hasOwn(data, 'mintAuthority');
  const hasFreezeAuthority = Object.hasOwn(data, 'freezeAuthority');
  return {
    holders, holderSource: holders == null ? null : 'RugCheck (indexed)',
    observedAt: typeof data.detectedAt === 'string' ? Date.parse(data.detectedAt) : null,
    // Null is evidence of no authority only when the exact property is included.
    indexedMintAuthority: hasMintAuthority ? data.mintAuthority : undefined,
    indexedFreezeAuthority: hasFreezeAuthority ? data.freezeAuthority : undefined,
    controlsAvailable: hasMintAuthority && hasFreezeAuthority &&
      (data.mintAuthority === null || typeof data.mintAuthority === 'string') &&
      (data.freezeAuthority === null || typeof data.freezeAuthority === 'string'),
  };
}

export function tokenAgeMetrics(market, solscan, now = Date.now(), rugcheck = null) {
  const firstPoolAt = epochSeconds(market?.firstIndexedPairAt);
  const createdAt = epochSeconds(solscan?.createdAt);
  const firstListedAt = epochSeconds(solscan?.firstTradingAt);
  // Solscan's first indexed listing is preferable for trading-age claims; earliest
  // currently indexed pair is a lower-bound on active trading history, not launch date.
  const firstTradingAt = firstListedAt ?? firstPoolAt;
  const source = firstListedAt ? 'Solscan first indexed listing' : firstPoolAt ? 'DEX Screener earliest currently indexed pair' : null;
  const observedAt = epochSeconds(rugcheck?.observedAt);
  const elapsed = (ts) => ts == null || ts > now ? null : Math.floor((now - ts) / 86400000);
  return {
    createdAt,
    observedAt, observedDays: elapsed(observedAt),
    observedSource: observedAt ? 'RugCheck first indexed detection' : null,
    ageDays: elapsed(createdAt),
    ageSource: solscan?.tokenAgeSource ?? null,
    firstTradingAt,
    tradingDays: elapsed(firstTradingAt),
    tradingAgeSource: source,
    caveat: 'DEX trading age uses an indexed listing/pair timestamp, not complete on-chain trade history; deleted or migrated pools can be older.',
  };
}

export function holderMetrics(solscan, market, gecko = null, rugcheck = null) {
  const holders = positiveInteger(solscan?.holders) ?? positiveInteger(gecko?.holders) ?? positiveInteger(rugcheck?.holders);
  const cap = number(market?.primaryPool?.marketCap); // NOT fdv; these are materially different concepts.
  const hasRatio = holders !== null && holders > 0 && cap !== null && cap > 0;
  return {
    holders,
    source: holders === null ? null : (solscan?.holders != null ? 'Solscan Pro API' : gecko?.holders != null ? 'GeckoTerminal (public)' : 'RugCheck (indexed)'),
    marketCapUsed: hasRatio ? cap : null,
    marketCapPerHolder: hasRatio ? Math.round(cap / holders * 100) / 100 : null,
    holdersPer100kCap: hasRatio ? Math.round((holders / cap * 100000) * 10) / 10 : null,
    holderTop20Pct: solscan?.holderTop20Pct ?? null,
    holderTop1Pct: solscan?.holderTop1Pct ?? null,
    holderTop10Pct: gecko?.holderTop10Pct ?? null,
    holderGini: solscan?.holderGini ?? null,
    caveat: 'Holder counts refer to observed addresses/accounts, not verified independent people. Market cap / holder is NOT the average token balance, evidence of holding duration, or a share-of-supply statistic. Dusting, custodians and Sybil wallets can distort counts.',
  };
}

// Positive lock credit requires externally verified ON-CHAIN Streamflow contract
// schedule, token mint, amount still inaccessible, and unlock time. An address label
// alone, or a user-submitted claim, is not accepted as proof.
export function validateVerifiedLocks(locks, mint, now = Date.now()) {
  if (!Array.isArray(locks)) return { status: 'not_verified', lockedAmount: null, lockedPct: null, unlockAt: null, contracts: [], source: null };
  const accepted = locks.filter((lock) =>
    lock?.source === 'verified_streamflow_contract' && lock.mint === mint &&
    lock?.cancelableBySender === false && lock?.cancelableByRecipient === false &&
    lock?.withdrawalDisabled === true && lock?.verifiedBy === 'onchain_sdk' &&
    epochSeconds(lock.unlockAt) !== null && epochSeconds(lock.unlockAt) > now &&
    number(lock.lockedAmount) !== null && number(lock.lockedAmount) > 0 &&
    typeof lock.contract === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(lock.contract)
  ).slice(0, 50);
  if (!accepted.length) return { status: 'not_verified', lockedAmount: null, lockedPct: null, unlockAt: null, contracts: [], source: null };
  // Indexing/integration layer must ensure different contract addresses; duplicates ignored.
  const unique = [...new Map(accepted.map(x => [x.contract, x])).values()];
  return { status: 'verified', lockedAmount: unique.reduce((sum, x) => sum + x.lockedAmount, 0),
    lockedPct: null, unlockAt: Math.min(...unique.map(x => epochSeconds(x.unlockAt))),
    contracts: unique.map(x => x.contract), source: 'Streamflow contracts checked on-chain' };
}
