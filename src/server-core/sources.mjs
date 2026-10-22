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
