const env = typeof process !== 'undefined' ? process.env : {};
// Dedicated RPC prevents public Solana endpoint rate limits that cause unknown mint controls.
// Server environment variables only; never expose a provider key in VITE_* values.
const RPC_URL = env.SOLANA_RPC_URL || (env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}` : 'https://api.mainnet-beta.solana.com');
const DEX_BASE = 'https://api.dexscreener.com';
const TIMEOUT = Math.max(1500, Math.min(Number(env.UPSTREAM_TIMEOUT_MS) || 7000, 15000));

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'accept': 'application/json', ...options.headers },
    });
    if (!response.ok) throw new Error(`upstream_http_${response.status}`);
    const len = Number(response.headers.get('content-length') || 0);
    if (len > 2_000_000) throw new Error('upstream_response_too_large');
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('upstream_response_too_large');
    return JSON.parse(body);
  } finally { clearTimeout(timer); }
}

export async function rpc(method, params) {
  const response = await fetchJson(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (response.error) throw new Error(`rpc_error_${response.error.code ?? 'unknown'}`);
  return response.result;
}

export async function getMintAccount(mint) {
  const data = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  return data?.value ?? null;
}

export async function getLargestTokenAccounts(mint) {
  const data = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
  return data?.value ?? [];
}

export async function getMarketPairs(mint) {
  const data = await fetchJson(`${DEX_BASE}/token-pairs/v1/solana/${encodeURIComponent(mint)}`);
  return Array.isArray(data) ? data.filter(p => p.chainId === 'solana').slice(0, 100) : [];
}

export async function searchSimilarTokens(text) {
  if (!text || text.length > 60) return [];
  const data = await fetchJson(`${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(text)}`);
  return Array.isArray(data?.pairs) ? data.pairs.filter(p => p.chainId === 'solana').slice(0, 100) : [];
}

// Solscan Pro endpoints are authenticated; scraping Solscan pages is not reliable.
// An absent key is a normal outcome and MUST NOT be interpreted as zero holders.
const solscanCache = new Map();
export async function getSolscanIntel(mint) {
  const key = typeof process !== 'undefined' ? process.env.SOLSCAN_API_KEY : undefined;
  if (!key) return null;
  const cached = solscanCache.get(mint);
  if (cached && cached.expires > Date.now()) return cached.data;
  const headers = { 'token': key };
  const paths = ['token/meta', 'token/statistic', 'token/holders?page=1&page_size=10'];
  const results = await Promise.allSettled(paths.map(path =>
    fetchJson(`https://pro-api.solscan.io/v2.0/${path}${path.includes('?') ? '&' : '?'}address=${encodeURIComponent(mint)}`, { headers })
  ));
  if (results.every(r => r.status === 'rejected')) throw new Error('solscan_api_unavailable');
  const data = {
    profile: results[0].status === 'fulfilled' && results[0].value?.success ? results[0].value : null,
    statistics: results[1].status === 'fulfilled' && results[1].value?.success ? results[1].value : null,
    holderList: results[2].status === 'fulfilled' && results[2].value?.success ? results[2].value : null,
  };
  solscanCache.set(mint, { data, expires: Date.now() + 10 * 60_000 });
  if (solscanCache.size > 200) solscanCache.clear();
  return data;
}

// Public GeckoTerminal holder snapshot. Free API has a ~30 requests/minute limit.
// Keep a per-isolate cache to avoid charging a new request for every repeated scan.
const geckoCache = new Map();
export async function getGeckoIntel(mint) {
  const cached = geckoCache.get(mint);
  if (cached && cached.expires > Date.now()) return cached.data;
  try {
    const data = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(mint)}/info`, { headers: { accept: 'application/json;version=20230203' } });
    const attributes = data?.data?.attributes;
    if (!attributes || (data.data.id && !String(data.data.id).endsWith(`_${mint}`))) return null;
    geckoCache.set(mint, { data: attributes, expires: Date.now() + 5 * 60_000 });
    if (geckoCache.size > 200) geckoCache.clear();
    return attributes;
  } catch (error) { throw error; }
}

// An independent fallback for holder counts and indexed mint control observations.
// RugCheck is a third-party indexer, not direct RPC verification. Never translate
// its pool/LP lock assessments into verified Streamflow lock contracts.
const rugcheckCache = new Map();
export async function getRugcheckIntel(mint) {
  const cached = rugcheckCache.get(mint);
  if (cached && cached.expires > Date.now()) return cached.data;
  const data = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`);
  if (!data || data.mint !== mint) return null;
  rugcheckCache.set(mint, { data, expires: Date.now() + 10 * 60_000 });
  if (rugcheckCache.size > 200) rugcheckCache.clear();
  return data;
}
