# Scarecrow Scanner — Lovable UI + Real Solana Data

This is the **Lovable Scarecrow Crypto Signal project** from the uploaded GitHub archive, with the simulated scanning logic replaced by the working Solana token scanner engine.

The original Lovable art, background, neon colors, circular gauge, panel layout, CSS, project configuration, and framework structure are retained. The scanner is **Solana-only**.

## Quick start (Windows PowerShell)

1. Extract the ZIP into a **new folder**, not `crowdon-web` and not your older `scarecrow-scanner` project.
2. Open PowerShell in that new folder (the folder with `package.json`).
3. Run:

```powershell
npm install
npm run test:scanner
npm run dev
```

4. Open the local URL shown in the terminal (the Vite/TanStack dev-server port, not the old scanner's `localhost:8787`).
5. Paste a Solana token mint such as:

`GtV6g1ey2NERrcbvL5bdzrxRJQDfxpMaLU9oLtRipump`

6. The UI calls **same-origin** `/api/v1/scan?mint=...`, which fetches Solana RPC and DEX Screener data from the server route.

If public Solana RPC rate-limits you, configure a dedicated RPC URL on your **server** using `SOLANA_RPC_URL`. Do not put an RPC key in a `VITE_*` client environment variable.

## Scanner components

- `src/routes/index.tsx`: Lovable screen rewritten to fetch real data rather than use deterministic random simulation.
- `src/routes/api/v1/scan.ts`: TanStack Start same-origin server route for real scans, 90-second in-memory cache.
- `src/routes/api/v1/search.ts`: Name/ticker candidate lookup via DEX Screener. Requires choosing a candidate before scanning.
- `src/server-core/scanner.mjs`: Solana token mint checks, market-pair analysis, lookalike discovery and provisional grade engine.
- `src/server-core/sources.mjs`: Upstream Solana RPC and DEX Screener HTTP requests.
- `src/server-core/validation.mjs`: Base58 address checks.
- `tests/scanner.test.mjs`: Tests for risk signals, incomplete-data behavior, grading preconditions.

### What is real

- Solana SPL/Token-2022 mint detection
- Mint authority, freeze authority, certain Token-2022 controls
- Indexed DEX liquidity, volume, market cap/FDV, pool count
- Similar ticker/name mint candidates, with *possible* duplicate indicators
- Top token-account concentration when Solana RPC provides it
- Provisional infrastructure grade **only when a mint and indexed trading pair can be verified**
- 1h/6h/24h volume windows when the indexed pair exposes them

### What remains to be built / integrated

- 1d, 3d, 7d and 30d **historical** performance and holder trends (today's 24h snapshot is not a history service)
- Verified wallet/holder clustering and insider/bundle percentage (top token accounts do not represent unique human holders)
- Official token identity/creator verification (highest volume is not proof of originality)
- Shared persistent Legit/Scam reactions and anti-sybil verified voting. The V0.3 reaction control is *local to the browser only*.
- Public suspicious-token report intake / admin moderation module and durable storage; that remains in the earlier standalone scanner backend and is **not silently merged** into this app.
- Production abuse prevention, persistent API caches, provider SLA, Cloudflare configuration, load testing and vulnerability review.

The futuristic progress animation is UI theater. It displays while an actual server-side scan runs, but is not a log of every RPC operation. A partial upstream result is shown as partial/unrated, not passed off as fully safe.

## Testing

`npm run test:scanner` — backend logic tests with mocked upstream responses.

`npm test` — Lovable's existing Vitest suite.

`npm run build` — full framework bundle (requires npm dependencies and supported runtime).

**Release note:** In the packaging environment, backend logic tests passed and TSX/TypeScript source syntax was checked, but a full `npm install` + `npm run build` and live mainnet integration test were **not** available. Perform those on your development machine before deploying.

## Handoff to the Scarecrow developer

Keep this project in its own GitHub repository (`scarecrow-crypto-signal` or equivalent), separate from Crowdon. The API endpoints are same-origin and do not require running the old Node scanner on port 8787. No wallet connection or message/transaction signing is used.

See `docs/INTEGRATION_NOTES.md` for integration warnings.
