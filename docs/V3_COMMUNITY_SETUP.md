# SCARECROW V3 — Cloudflare D1 community setup

## What changes

V3 leaves `/api/v1/scan` and `/api/v1/search` intact. It adds a shared opt-in **Recent Token Submissions** board, shared **Legit / Concern** reaction counts, and a moderated **Suggestion Box**. No wallet connection or private keys are involved. The existing browser-local Recent Pastes remain browser-only and are not published without a separate explicit submission.

**Do not push V3 until D1 has been created, initialized, and the binding setup has been checked.** Without D1, scanning still works but the V3 board clearly shows offline and reaction/submission buttons are disabled.

## 1. Create the separate D1 database

In the Cloudflare dashboard, find **Workers & Pages → D1 SQL Database → Create**, name it `scarecrow-community` and copy its database ID (UUID). Use a new database; do NOT connect the Crowdon/Supabase production database or reuse another D1 database.

## 2. Apply the SQL schema once

From PowerShell in the *GitHub clone folder*:

```powershell
cd "$HOME\OneDrive\Desktop\scarecrow-scanner-github"
npx wrangler login
npx wrangler d1 execute scarecrow-community --remote --file=./db/001_community.sql
```

Alternatively open the new D1 database's SQL console in Cloudflare and paste `db/001_community.sql`. The SQL uses `IF NOT EXISTS`, so re-applying the schema without manual edits is safe. Test with `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'community_%';` (expect 3 tables).

## 3. Configure the binding for repeatable Git deployments

In **Workers & Pages → scarecrow-scanner → Settings → Builds → Variables and secrets**, add a BUILD variable:

- Name: `SCARECROW_D1_DATABASE_ID`
- Value: the UUID of the **new** D1 database; this ID is not a password.

`nitro.config.ts` reads this only when building, pins the Worker name to `scarecrow-scanner`, and embeds the D1 binding `SCARECROW_DB` into Nitro's generated Wrangler config. This avoids a manual dashboard-only binding being lost on later `wrangler deploy` builds.

**Local build verification:** set `$env:SCARECROW_D1_DATABASE_ID="<YOUR-D1-UUID>"` in PowerShell, run `npm run build`, and inspect `.output/server/wrangler.json`. It should contain `"name": "scarecrow-scanner"` and `"binding": "SCARECROW_DB"` pointing to the correct UUID. If not, DO NOT deploy; share the generated config for inspection. This integration was not production-deployed here.

## 4. Set a runtime-only secret for signed anonymous browser sessions

Generate a 64-character secret in PowerShell:

```powershell
([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
```

In **Workers & Pages → scarecrow-scanner → Settings → Variables and Secrets**, create a **Secret** called `SCARECROW_SESSION_SECRET`, with that generated value. Never paste it into the repository or send it in a screenshot. This is a runtime secret, not a `VITE_` variable and not merely a Builds environment variable.

After V3 deploy, confirm this secret is available to the active Worker. Its value must be at least 32 characters. Rotating it invalidates existing anonymous voting sessions and enables a person to vote again, so rotate only when necessary.

## 5. Confirm build settings and deploy

Keep the existing project settings: build `bun run build`, deploy `npx wrangler deploy`, root `/`, production branch `main`. Do not change the deployment target or use `wrangler --name` to create a second Worker.

Before pushing, verify `npm run test:scanner`, `npm run test:community`, `npm run build` in your GitHub repository. Ensure the generated Wrangler config targets the **existing** `scarecrow-scanner` Worker. Then commit/push to `main`; confirm production deployment is Ready.

## 6. Test live behavior

1. Scan a token, press **ADD TO FIELD BOARD**. It should appear in Recent Token Submissions on another browser after refresh.
2. Press **LEGIT** or **CONCERN**. It should save on Cloudflare, count up on another browser, and prevent another vote for the same mint from the same signed browser session.
3. Send a test suggestion. The UI should report **awaiting review**. Only approved suggestions are publicly visible.
4. In Cloudflare's D1 SQL console, check:

```sql
SELECT mint, choice, created_at FROM community_votes ORDER BY created_at DESC LIMIT 10;
SELECT mint, label, created_at FROM community_submissions ORDER BY created_at DESC LIMIT 10;
SELECT id, kind, message, status, created_at FROM community_suggestions ORDER BY created_at DESC LIMIT 10;
```

## 7. Moderate suggestions

All suggestions start with `status='pending'` and are **not public**. Read pending suggestions through the D1 console, review personal information, spam, abuse and potentially defamatory statements before approving:

```sql
SELECT id, kind, message, datetime(created_at,'unixepoch') AS submitted_at
FROM community_suggestions WHERE status = 'pending'
ORDER BY created_at DESC LIMIT 50;

-- Replace the example ID with a real ID. Only approve after reviewing the text.
UPDATE community_suggestions SET status='approved', reviewed_at=unixepoch()
WHERE id='REPLACE_WITH_REAL_ID' AND status='pending';

-- Or reject inappropriate submissions:
UPDATE community_suggestions SET status='rejected', reviewed_at=unixepoch()
WHERE id='REPLACE_WITH_REAL_ID' AND status='pending';
```

Do not publish submission authors or attempt to infer their identities.

## Limits, disclosures and next hardening steps

- **One per signed browser, not one per verified individual.** Cookies can be cleared or different devices used. The totals are **unverified anonymous opinions**, not a fraud verdict, proof of token safety, or a recommendation.
- Per-browser soft limits: **30 token reactions/day, 10 token submissions/day, 3 suggestions/day**. Unique `(mint, browser)` constraints prevent repeated reactions and repeated token submissions even with concurrent clicks. Soft limits alone cannot stop Sybil accounts or bots. Add Cloudflare WAF rate limiting / Turnstile and a trusted identity system before large-scale promotion or treating vote counts as reputation signals.
- The anonymous cookie is Secure, HttpOnly, SameSite=Lax, signed with a server secret, expires in 180 days; only an HMAC-derived pseudonymous hash is stored. No raw IPs, emails, wallet addresses or authentication credentials are stored by these V3 tables. Do not submit private personal information to suggestions.
- Reactions and submissions are retained in D1 until manually deleted; suggestions are retained until moderated/deleted. Publish a privacy/data retention notice before broad use. Cloudflare/network logs may independently retain request metadata per your Cloudflare settings.
- Community features return **503 and clearly show Offline** until storage/secret exists. They never claim to save anything locally as a substitute for shared storage.
- Previous V2 browser-local reactions cannot be reliably migrated to shared voting; visitors can vote again in V3.
- Community data is not used to change the scanner's evidence-based infrastructure grade.
