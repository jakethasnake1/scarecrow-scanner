# Developer handoff — Scarecrow real scanner integration

**Source**: User-provided Lovable `scarecrow-crypto-signal-main.zip`; same UI preserved.

**Architecture:** TanStack Start API routes (`/api/v1/scan`, `/api/v1/search`) import the open-source read-only Solana token screening code from `src/server-core`. Frontend uses relative URLs; no separate service is required during `npm run dev`.

**Runtime:** `fetch` and `AbortController` are needed server-side; default RPC is Solana's public mainnet-beta endpoint and DEX data comes from DEX Screener. Rate limits, CORS, provider failures, empty/unindexed tokens, and Node/Cloudflare `process.env` handling require production testing. Use a server-side RPC secret if needed.

**Token authenticity:** Search candidate order uses observed volume; never call a candidate official or original without independent confirmation. A possible duplicate is simply a lookalike with weak/ambiguous market indicators. Same tickers are common.

**Grading:** The A+–F- formula is a provisional product heuristic, not a financial, investment or security audit. Null scores show N/A. Missing insider/bundle/history indicators are explicitly listed. A mint without both an on-chain verification and an indexed pair receives no letter grade. Do not quietly treat unavailable metrics as zero risk.

**Voting:** Browser-only localStorage prevents repeats only in the same browser. It is not one-person-one-vote and cannot support global public counts. Future persistent votes require user identity, a database, abuse controls, and moderation. Current reactions are individual annotations with no aggregated vote totals.

**Reports:** The prior Node-only standalone report moderation system is *not copied into these Cloudflare-targeted TanStack routes*. Production persistent reports need a database, review workflow and policy to avoid false accusations. Prefer separate schema/API to minimize risk.

**No-wallet behavior:** Scanner fetches no private keys or connected wallet data and never asks to approve a transaction.

**Testing performed:** `node --test tests/scanner.test.mjs` passes. TypeScript/TSX isolated syntax-transpilation passes. Live endpoints/framework build require installation of dependencies and a working RPC/network on development infrastructure.

**Production hardening:** Implement rate limiting at edge, proper quotas, request timeout, cache by mint and epoch, observability, uptime monitoring, content abuse moderation, and a staging launch test before announcing the scanner publicly.
