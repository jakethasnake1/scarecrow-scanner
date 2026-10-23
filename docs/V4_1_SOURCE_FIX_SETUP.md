# SCARECROW V4.1 — Source Recovery, Holder Fallback & Fair Grading

This is a targeted **V4 -> V4.1 correction**. It modifies the scanner, data-source adapters, evidence dashboard and tests. It does **not** affect V3 community voting tables, wallet connections, coin metadata, or the golden-wheat favicon.

## Why V4 showed UNAVAILABLE

- Solscan Pro queries require `SOLSCAN_API_KEY`; V4 did not ask the API's explicit `/token/holders` endpoint.
- Public Solana RPC often rate limits `getAccountInfo`, leaving mint and freeze controls unknown; configure a reliable dedicated RPC, ideally `SOLANA_RPC_URL` or `HELIUS_API_KEY` on the Cloudflare **Worker** (not on the browser).
- GeckoTerminal may return null or rate limits. V4 swallowed failures and offered no provider diagnostics; V4.1 shows a safe status per provider, adds an independent RugCheck indexed fallback and uses versioned GeckoTerminal headers.
- Streamflow locks are not verified: no signed, indexed Streamflow lock-contract integration was shipped in V4.1. No lock credit is claimed.

## What changed in V4.1

- Solscan Pro queries `/token/meta`, `/token/statistic`, **and `/token/holders`**, preferring the returned `data.total` when available. The optional Solscan key is a private Worker secret.
- GeckoTerminal (free, rate limited) runs first in parallel with the rest; RugCheck's public full token report is another holder fallback (`totalHolders`). RugCheck's `mintAuthority` and `freezeAuthority` fields are accepted only as **third-party indexed observations**, not as directly verified RPC facts. Reports must match the exact mint.
- Grade uses small positive weight for indexed *relative liquidity / market cap* only when market cap is at least $100K and pool liquidity at least $10K (never the token's FDV). For DEX-only grades, RugCheck's explicitly reported active controls worsen score; explicitly absent controls offer limited positive credit. The capped DEX-only grade remains C+; missing feeds reduce coverage/confidence.
- Source health shows `OK`, `NO_DATA`, `RATE_LIMITED`, `NOT_CONFIGURED`, `AUTH_OR_ACCESS_DENIED`, etc. All error text is sanitized server side. A source returning no holder count will show `NO HOLDER COUNT`.
- Token creation age remains missing unless supported by Solscan. RugCheck `detectedAt` is shown separately as **earliest indexer detection**, never labeled as true mint creation.
- Shared community voting is unchanged and requires the D1 bindings from `docs/V3_COMMUNITY_SETUP.md`.

## Recommended Cloudflare configuration

Cloudflare -> Workers & Pages -> **scarecrow-scanner** -> Settings -> **Variables and Secrets**:

- Set **SOLANA_RPC_URL** to a dedicated Solana mainnet HTTPS RPC URL (recommended), **or** `HELIUS_API_KEY` to a Helius mainnet key. Use Secret type (provider URLs may themselves contain credentials). `SOLANA_RPC_URL` takes precedence.
- Set optional **SOLSCAN_API_KEY** as a Secret if you have Solscan Pro API access. The token data will work *without* Solscan when GeckoTerminal or RugCheck returns it, but creation timestamps generally need Solscan.
- After changing variables/secrets, deploy the updated Worker configuration, then re-run a scan (previous cached scans may last up to 90 seconds in individual Workers).
- Do not set `VITE_*` values for private keys, paste them in code, or commit `.env` files.

## Install V4.1 to the correct checkout

There are two folders: your extracted project at `scarecrow-scanner` and your Git-connected clone at `scarecrow-scanner-github`. Copy the ZIP's contents to **the GitHub folder directly**, with no nested folder.

```powershell
cd "$HOME\OneDrive\Desktop\scarecrow-scanner-github"
npm run test:scanner
npm run test:community
node --test tests/intelligence.test.mjs
npm run build
# Ensure generated .output/server/wrangler.json points to scarecrow-scanner
# git add -A; git commit -m "Fix scanner V4.1 holder sources and grades"; git push origin main
```

Stop before pushing if the build fails or generated Worker target is not `scarecrow-scanner`.

## Honest limitations

- No live GeckoTerminal, RugCheck, Solscan, Helius, or Cloudflare integration test could be made in the artifact build environment. Availability and holder count cannot be guaranteed. No current CROW holder number is asserted.
- Do not treat token holder accounts as unique humans. Sybil addresses, vaults, LPs, custody, dusting, and locked allocations can distort statistics.
- Market cap divided by observed holder accounts does **not** measure average token holdings, community share of supply, holding duration, or organic participation.
- RugCheck indexed authority fields are a useful corroboration, not a substitute for an authoritative on-chain RPC verification.
- Grade is a limited infrastructure indicator and not a fraud, legitimacy or investment-safety verdict. No CROW-specific exceptions or manual score overrides have been added.

### Relevant provider references

- https://pro-api.solscan.io/pro-api-docs/v2.0/referenc/v2-token-meta
- https://pro-api.solscan.io/pro-api-docs/v2.0/referenc/v2-token-holders
- https://api.geckoterminal.com/docs/index.html
- https://api.rugcheck.xyz/v1/tokens/GtV6g1ey2NERrcbvL5bdzrxRJQDfxpMaLU9oLtRipump/report
- https://developers.cloudflare.com/workers/configuration/secrets/
