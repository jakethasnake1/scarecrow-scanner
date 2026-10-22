# SCARECROW Scanner — V2 Release Notes

## What changed

1. Replaced the browser-tab favicon with your supplied SCARECROW coin portrait (16/32/48/64-pixel ICO; PNG and touch icons included). A central crop keeps the eyes and stitched face legible at small size.
2. Rebuilt the scanner grade fallback to issue an A+–F- provisional infrastructure grade when either the on-chain mint facts or a DEX market pair can be observed. Missing feeds never turn into imaginary on-chain facts.
3. Added a labeled grade basis (ON-CHAIN + DEX, ON-CHAIN ONLY, or DEX ONLY), evidence coverage percentage, and HIGH / MEDIUM / LOW confidence.
4. Grades based on only one primary source cannot exceed C+. This is a completeness cap, *not* proof of risk or fraud.
5. A confirmed non-token address is displayed as `F- / NOT A TOKEN`. With no verifiable evidence at all, the result is `U / FEEDS UNAVAILABLE` (not an invented grade).
6. Added optional server-side `HELIUS_API_KEY` configuration if `SOLANA_RPC_URL` is not already present, to improve RPC coverage.
7. Shorter API cache TTL for outages (15 sec) and low-confidence reports (30 sec) so those responses do not linger as long as complete scans (90 sec).
8. Added tests for degraded RPC, market-only scoring, chain-only scoring, invalid mints, and authority penalties.

## Deployment

Merge the changed files into your existing Scarecrow Scanner repository (do not merge into Crowdon), commit, push, and deploy as usual.

For local development in Windows PowerShell:

```powershell
npm install
npm run test:scanner
npm run build
npm run dev
```

For a reliable production RPC, set either `SOLANA_RPC_URL` or `HELIUS_API_KEY` in the hosting provider's **server environment**, then redeploy. Do **not** commit API keys or prefix them with `VITE_`.

If the old favicon persists, perform a hard refresh or reopen the site tab; browser favicons are aggressively cached.

## Validation performed in this environment

- 14/14 backend scanner tests passed.
- `node --check` passed for the scanner and upstream-source modules.
- 61 TS/TSX files passed syntax transpilation.
- Full `npm install` and `npm run build` could **not** be completed in the packaging environment because npm registry downloads failed with `EAI_AGAIN` (network/DNS unavailable). Run `npm install && npm run build` before deploying.
- A live RPC/mainnet end-to-end scan was not run here.

## What it does not do

Grades are not guarantees of legitimate ownership, market integrity, or ability to sell. The heuristic does not yet include verified insider holdings, bundle clusters, or multi-day historical analysis. Those remain separate future feature upgrades.
