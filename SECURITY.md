# Security checklist — Web2APK / APK Forge

Status legend: ✅ done in code · ⚠️ needs an action from you · ℹ️ known limitation

## Before going live (do these once)
- ⚠️ **Run `supabase/migrations/20261113_web2apk_security.sql`** in the Supabase SQL editor. Until you do, every table is readable **and writable** with the public anon key (RLS is not enabled; the project tooling cannot enable it). The server is built so that this cannot be turned into an account takeover (see "Defence in depth" below), but data such as build logs and project names is exposed until RLS is on.
- ⚠️ Set the new env vars from `.env.example` on your host: `PUBLIC_BASE_URL`, `APP_ENCRYPTION_KEY`, `HASH_PEPPER`, `CALLBACK_SECRET`, `ADMIN_JWT_SECRET`, `ADMIN_PATH`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (`npm run admin:hash`), `CORS_ORIGINS`. Set the four secrets **before first use and never change them** (stored hashes/ciphertexts depend on them). If unset they are derived from `SUPABASE_SERVICE_ROLE_KEY`; rotating that key then invalidates API keys, bot tokens and agent tokens.
- ⚠️ Enable the pre-commit secret scan: `git config core.hooksPath .githooks`.
- ⚠️ Sign in to the admin console and enable TOTP 2FA (Security tab).

## Authentication & sessions
- ✅ Admin console only exists at `/api/<ADMIN_PATH>` (16–64 random chars, not `admin*`); no links anywhere; any other path, and every admin API call without a valid session, returns the same plain `404 {"error":"Not found"}`.
- ✅ Admin passwords: bcrypt (cost 12), 14+ chars with 3 character classes; optional TOTP (RFC 6238); credentials stored in the private storage vault, not in a table.
- ✅ Brute force: per-account lockout after 5 failures (15 min, doubling up to 4 h, persisted), per-IP limiter (10 / 15 min), constant-time dummy hash for unknown emails, every attempt audited.
- ✅ Cookies: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Strict`; 10-minute HS256 JWT access token (issuer/audience pinned, `alg` pinned); 8-hour refresh token, rotated on every use, stored as a peppered HMAC; **reuse of an old refresh token revokes the session**.
- ✅ CSRF for cookie routes: double-submit token header + Origin/Referer same-host check + SameSite=Strict. Login also requires same origin.
- ✅ Audit log of every admin action (login, failures, bans, revocations, settings, 2FA, password, build log views). The SQL migration makes it append-only.
- ✅ Banned users are rejected on every request, and their API keys / Telegram bots stop working.

## Secrets
- ✅ Service-role key is only read in `api/db-client.js` (server). `npm run check:secrets` fails if frontend code references it, or if any service-role JWT, `sb_secret_`, GitHub/Telegram/AWS token, private key, API key or `.env` file is about to be committed.
- ✅ Telegram bot tokens, webhook signing secrets and TOTP secrets: AES-256-GCM (authenticated) with a server key; never returned to the browser after saving.
- ✅ API keys (`w2a_…`), agent tokens, Telegram webhook secrets and refresh tokens are stored only as **HMAC-SHA256 with a server-side pepper** — a row inserted by someone without the pepper can never match.
- ✅ GitHub tokens and system settings live in the private `secrets` bucket (service role only).

## Input handling
- ✅ zod validation on every route (unknown keys rejected); JSON body limit 1 MB; malformed JSON → 400.
- ✅ Gradle task / module / extra args / versions restricted to safe character sets (no shell metacharacters — also protects the Windows agent which runs with a shell).
- ✅ Package names: lowercase segments, no leading digits, no Java/Kotlin keywords. App names: control/bidi characters stripped, 50 chars max.
- ✅ Generated Kotlin/XML: Kotlin strings escape `\` `"` `$` and control chars; Android string resources escape `\` `"` `'` `@`/`?` and XML entities; URLs are re-serialised by the URL parser. Verified by compiling an app named `@Bob's "Café" $HOME ${System.exit(0)} \ 🚀 مرحبا`.
- ✅ Only the Supabase query builder is used (parameterised; no string-built SQL, no user input in `.or()` filters).
- ✅ Error responses never contain stack traces or internal messages (generic 500 with a reference id; details only in server logs).

## SSRF (website URL, icon URL, webhook URL)
- ✅ `http(s)` only (`https` for icons and webhooks), no credentials in URLs, ports 80/443/8080/8443 only.
- ✅ Blocks localhost / `.local` / `.internal` / metadata hostnames, numeric host tricks, and every private, loopback, link-local, CGNAT, multicast, documentation, NAT64 and IPv4-mapped range (IPv4 + IPv6), including `169.254.169.254` and `fd00:ec2::254`.
- ✅ The resolved IP is re-checked **at connect time** (defeats DNS rebinding) and **every redirect hop** is re-validated; max 3–5 redirects, timeouts, response size caps (icons 1 MB, magic-byte checked PNG/JPEG/WebP).
- ✅ Outgoing webhooks: no redirects followed, signed `X-Web2APK-Signature: t=…,v1=HMAC_SHA256(secret, "t.body")`.

## Transport, CORS, headers, rate limits
- ✅ CORS allowlist (same origin + `CORS_ORIGINS`; `/api/v1` additionally `API_CORS_ORIGINS`); cross-origin state-changing requests from other origins are refused with 403.
- ✅ helmet on the API (CSP `default-src 'none'`, HSTS, nosniff, no-referrer, no `X-Powered-By`); admin page has a nonce-based CSP and `frame-ancestors 'none'`; SPA gets nosniff/HSTS/Referrer-Policy/Permissions-Policy (Vercel) or a full CSP (standalone server).
- ✅ Rate limits: global per-IP limiter; `/api/v1` per-IP limiter; per-API-key hourly limit + monthly quota; per-Telegram-chat and per-user hourly build limits (all counted from the database, so they hold across serverless instances).
- ℹ️ The per-IP limiters are in-memory, so on serverless they are per instance (best effort). The per-key/per-user/per-chat limits are exact.

## Build pipeline
- ✅ Request handlers never compile anything: they create the job row, trigger GitHub Actions (`workflow_dispatch`) and return.
- ✅ The runner downloads sources through a 2-hour signed URL and reports back with callbacks signed by a per-build HMAC key (timestamp window 15 min, constant-time comparison, terminal builds ignore further callbacks). APKs are uploaded through a single-use signed upload URL limited to `apks/<user>/build-<id>/`.
- ✅ Telegram webhooks are authenticated with a random per-bot `secret_token` on every request; private by default (owner chat linked with a one-time deep-link code).

## Known limitations
- ℹ️ The `project-zips` and `apks` buckets are public-by-URL (random, unguessable paths). Uncomment the last line of the SQL migration to make sources private (breaks the dashboard "Source" link).
- ℹ️ The per-build callback key is visible in the workflow inputs of **your own private** `apk-forge-builds` repo; it only works for that one build and stops working once the build finishes.
- ℹ️ `PUBLIC_BASE_URL` should be set: without it, callback/webhook URLs are derived from the request host.
- ℹ️ Netlify wrapper is provided but untested; Vercel and the standalone Node/Docker server were tested.
