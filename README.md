# Prof Ali Kotb — Smart Rephrase

Bilingual (Arabic / English / mixed) rephrasing web app that polishes wording **without changing meaning, facts, numbers, negations, laterality, certainty or citation markers**. Next.js 16 + TypeScript + Tailwind v4, server-side Gemini via the official `@google/genai` SDK, deployable to Vercel from GitHub.

---

## 1. Model choice (verified)

| | |
|---|---|
| **Default `GEMINI_MODEL`** | `gemini-3.5-flash-lite` |
| Verified on | **19/10/2026** against `ai.google.dev/gemini-api/docs/models` (page last updated 13/10/2026) and the deprecations page |
| Status | Stable, no shutdown date announced; Google's models page recommends 3.5 Flash-Lite / 3.8 Flash for new projects (2.5 family is restricted to existing users) |
| Capabilities used | Text in/out, system instructions, streaming (`streamGenerateContent`), thinking control |
| Thinking | `GEMINI_THINKING_LEVEL=minimal` (supported on 3.5 Flash-Lite and 3.6 Flash; **not** on 3.8 Flash, which starts at `low`) |
| Suggested fallback | `gemini-3.6-flash` (stable; supports `minimal`) |

**Why this model:** rewriting is a fidelity task, not a reasoning task. Flash-Lite with minimal thinking gives the lowest latency/cost while still following a strict instruction contract; the stronger `gemini-3.6-flash` / `gemini-3.8-flash` are one env change away if your own quality checks show you need them.

**Why GenerateContent and not the Interactions API:** Google recommends Interactions for new agentic work, but states `generateContent` "remains fully supported". It is stateless (nothing stored as a server-side interaction), has mature streaming/abort semantics in the SDK, and fits a single-turn rewrite exactly.

**Temperature:** not sent by default (model default). Gemini 3 guidance has discouraged lowering temperature (risk of looping); fidelity is enforced by the system instruction, minimal thinking, and deterministic post-checks. Override with `GEMINI_TEMPERATURE` only after testing.

> ⚠ **Not verified with a live key:** this build environment had no Gemini API key, so no real Arabic/English quality evaluation or latency measurement was performed. Run `npm run check:model` (section 5) before relying on it — it streams three representative samples (Egyptian-Arabic clinical note, English academic sentence, prompt-injection) and prints time-to-first-token and total time.

---

## 2. Quick start (local)

```bash
git clone https://github.com/<you>/smart-rephrase.git && cd smart-rephrase
npm ci
cp .env.example .env.local      # then fill GEMINI_API_KEY at least
npm run dev                     # http://localhost:3000
```

In development, access control and Redis are optional (an in-memory limiter is used).

### Getting a Gemini API key
1. Open **https://aistudio.google.com/apikey** → *Create API key* (choose or create a Google Cloud project).
2. Paste it into `GEMINI_API_KEY` in `.env.local` (local) or Vercel env vars (production). Never prefix it with `NEXT_PUBLIC_`.
3. **Data terms matter for clinical text.** On the *free/unpaid* tier Google may use prompts and responses to improve products, including human review, and asks you not to submit sensitive/personal data. On a *paid* (billing-enabled) project prompts are not used for product improvement but are logged for a limited period for abuse monitoring. For anything containing patient identifiers, use a billing-enabled project — or de-identify first.

---

## 3. Deploy to Vercel

1. Push this repo to GitHub (private recommended).
2. Vercel → *Add New Project* → import the repo (framework auto-detected: Next.js; no build settings to change).
3. **Storage → Marketplace → Upstash for Redis** → create a free database and connect it to the project. This injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `_TOKEN`); both naming schemes are supported.
4. **Settings → Environment Variables** (Production + Preview):

| Variable | Required | Value |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | your key |
| `GEMINI_MODEL` | – | `gemini-3.5-flash-lite` (default) |
| `GEMINI_FALLBACK_MODEL` | – | e.g. `gemini-3.6-flash` |
| `GEMINI_THINKING_LEVEL` | – | `minimal` (default) / `low` / `medium` / `high` / `default` |
| `ACCESS_PASSWORD` | ✅ for private use | a long passphrase |
| `SESSION_SECRET` | ✅ with password | `openssl rand -base64 48` (≥ 32 chars) |
| `PUBLIC_ACCESS` | – | `true` only if you deliberately want no login |
| `RATE_LIMIT_PER_MINUTE` | – | default `20` per session/IP |
| `RATE_LIMIT_MODE` | – | `off` only for trusted deployments without Redis |

5. Deploy. Changing env vars requires a **Redeploy** (the footer's model name is baked in at build).

**Fail-closed by design:** in production the API returns `not_configured` unless either `ACCESS_PASSWORD`+`SESSION_SECRET` or `PUBLIC_ACCESS=true` is set, and `rate_limit_unconfigured` unless Redis is connected (or `RATE_LIMIT_MODE=off`).

**Function duration:** `src/app/api/rephrase/route.ts` sets `maxDuration = 60` s (> the 45 s operation budget; Vercel Hobby with Fluid Compute allows this). A test asserts it stays in sync with `SERVER_MAX_DURATION_S`.

### Install on iPhone
Safari → Share → *Add to Home Screen*. The shell (no text, no API responses) is cached by `public/sw.js`, so the editor opens offline; rewriting always needs the internet.

---

## 4. How it works

```
src/
  app/
    api/rephrase/route.ts      → createRephraseHandler() (Node runtime, maxDuration 60)
    api/auth/{login,logout,session}/route.ts
    layout.tsx  page.tsx  manifest.ts  globals.css
  components/                  App, Controls, ResultPane, BidiText, Dialogs, ui, icons
  lib/
    shared/   options.ts (schema, limits, defaults) · timeouts.ts (ALL time budgets) · protocol.ts (NDJSON)
              errors.ts · stream-guard.ts · text.ts · output.ts (marker parser) · fidelity.ts
    server/   prompt.ts (system instruction) · gemini.ts (SDK adapter) · handler.ts · provider-errors.ts
              auth.ts · auth-routes.ts · rate-limit.ts · security.ts · env.ts
    client/   runner.ts (retries/timeouts) · state.ts (state machine) · useRephrase.ts · persistence.ts
              hooks.ts · i18n/{en,ar}.ts
public/sw.js                   app-shell-only service worker
scripts/check-secrets.mjs      bundle + repo secret scan
scripts/check-model.mjs        live model availability, latency and sample quality
tests/{unit,server,client,e2e}
```

**Request lifecycle** — `idle → connecting → generating → completed`, plus `retrying`, `cancelled`, `offline`, `timed_out`, `error`.

* **One owner for retries.** The browser runner makes ≤ 3 attempts (1 + 2 retries) inside one 45 s deadline. SDK HTTP retries are disabled (`attempts: 1`) and SDK *automatic stream continuation* is disabled, so each attempt = exactly one Gemini call, and a dropped stream is never silently resumed/concatenated.
* **Retried automatically (before any text only):** network errors, first-content timeout, 429 *rate limit* (honours `Retry-After` / Google `RetryInfo`; skipped if it would exceed the deadline), 5xx, 503 overloaded, 404 model unavailable (next attempt uses `GEMINI_FALLBACK_MODEL` if set — never for quota/auth). **Never retried:** exhausted quota (daily / zero / billing), invalid key/permission/region, invalid request, blocked, empty.
* **Real cancellation.** Stop → `AbortController` aborts the browser fetch; the server sees the disconnect (`request.signal` / stream `cancel()`) and aborts the SDK call via `abortSignal`, closing the socket to Google. Billing for tokens already generated cannot be prevented.
* **Timeouts** (`src/lib/shared/timeouts.ts`): first content 15 s/attempt, inactivity 12 s, overall 45 s (always wins, including backoff). Server enforces them against Gemini; the client adds 2.5 s grace so the server reports first.
* **Stale protection.** Every operation has a UUID; late events from cancelled/superseded ops are dropped. Each result stores the exact input + settings fingerprint ("original changed since this result" badge).
* **Mobile lifecycle.** `offline` aborts the op (draft kept); returning from background after > 12 s mid-stream or past the deadline ends the op as *interrupted*; `pagehide`/bfcache restore never leave a spinner. Reconnection shows **Retry**; nothing is auto-submitted.
* **Honest output states.** Partial text after a failure, `MAX_TOKENS`, a stream without a finish reason, or a safety stop are shown as a labelled *incomplete* result with Restart/Discard — never as finished.
* **Prompt-injection hardening.** Source text is sent inside a per-request random boundary (`<<<SOURCE_<nonce> … SOURCE_<nonce>>>`); the system instruction states it is data; custom instructions are explicitly subordinate to the fidelity rules.
* **Fidelity post-check (heuristic).** Compares numbers (Arabic-Indic digits normalised), negations (EN + AR incl. Egyptian), laterality, certainty words and preserved terms between source and result, and lists differences to review. It cannot prove semantic equivalence.
* **Bidi.** UI direction follows the interface language; each editor's direction follows its own text; output paragraphs get their own direction and Latin runs/URLs are `<bdi>`-isolated inside Arabic (trailing punctuation kept outside). Output is always rendered as text, never HTML.

### Privacy
No server logging of source or generated text (only request id, mode, model, char counts, durations, error code — enforced by a test). No analytics. Local storage holds preferences only, unless you enable *Remember draft* or *Local history* (last 20, this device only, not synced). *Private session* never writes text and wipes saved text. *Delete saved data* removes drafts, history and saved custom terms.

### Security
Server-only secrets; zod validation of every field with `.strict()`; 64 KB body cap read incrementally; 8 000-character input limit (never truncated, submission blocked with a message); same-origin enforcement (`Origin` / `Sec-Fetch-Site`); HMAC-signed HttpOnly `SameSite=Strict` session cookie with constant-time password check and a 5/min login limiter; Upstash sliding-window rate limit (1.5 s Redis timeout fails open so a Redis hiccup doesn't block you); CSP (`connect-src 'self'`, `frame-ancestors 'none'`, no eval), `nosniff`, `no-referrer`, `DENY` framing. CSP keeps `'unsafe-inline'` for scripts because the App Router injects inline bootstrap scripts; nonce-based CSP would force dynamic rendering of every page.

---

## Abbreviations (text expansion)

* **While typing** in the original text: type an abbreviation (any case) then a space, Enter or punctuation → it is replaced by its full text (`ldnot ` → `LUMBAR DISCS NOT IMPROVED BY MEDICAL TREATMENT `). Press **Backspace** immediately to get the abbreviation back (it then won't re-expand).
* **Suggestion bar** under the editor shows matching abbreviations as you type 2+ letters — tap one to insert it. If the text contains unexpanded abbreviations (e.g. pasted notes), an **Expand N abbreviation(s)** chip expands them all; *Restore previous original* undoes it.
* An abbreviation typed as the very last word is expanded automatically when you press **Rephrase**.
* **Manage**: the **AB** button in the header (or **+** in the editor header) opens the list — search, add, edit, rename, delete, **Import list** (paste `ABB<Tab>FULL TEXT` lines straight from Excel/Access), **Export .tsv**, **Add missing defaults**, and the *Expand while typing* switch. Select a phrase in the editor before pressing **+** to pre-fill its full text.
* **Storage**: with Upstash Redis connected, the list is stored in Redis (`sr:abbr:v1` hash) and **synced between phone and desktop**; each edit is atomic per entry. Without Redis the list is kept on the device only (the dialog says so). A cached copy is kept on each device for offline use.
* The starter list lives in `src/lib/shared/abbreviations.ts` and only seeds an empty store — later edits are made in the app.
* API: `GET/POST /api/abbreviations` (same password session, same-origin writes, 60 req/min).

## 5. Commands

| Command | What it does |
|---|---|
| `npm run dev` | local dev server |
| `npm run verify` | typecheck → lint → unit/integration tests → production build → secret scan |
| `npm test` | Vitest (unit, server, client, UI) |
| `npm run test:e2e` | (after `npm run build`; `npx playwright install chromium` once) Playwright: real Next server + real SDK against a local mock Gemini (`tests/e2e/mock-gemini-server.mjs`) |
| `npm run check:secrets` | scans browser bundles + tracked files (run after a build with real or sentinel secrets in env) |
| `npm run check:model` | **live** check of `GEMINI_MODEL` (+ fallback): metadata, 3 streamed samples, latency |

---

## 6. Verification actually performed (19/10/2026)

* `npm run verify` — TypeScript ✔, ESLint ✔, **110 Vitest tests ✔**, `next build` ✔, secret scan ✔ (build run with sentinel `GEMINI_API_KEY`, `ACCESS_PASSWORD`, `SESSION_SECRET`; none found in 58 client assets).
* Gemini adapter tested with the **real `@google/genai` 2.30 SDK** over a mocked transport: request shape (system instruction, `thinkingLevel: MINIMAL`, `candidateCount: 1`), no SDK retry on 503, no auto-resume after a dropped stream, abort closes the request.
* Covered scenarios: Arabic RTL / English LTR / mixed text, number/date/negation/medical preservation checks, prompt injection inside the source, delayed first response, stall after start, slow connection, offline before submit, connection loss mid-generation, recovery after reconnect, cancel during connect/generate/backoff, late response after cancel, repeated clicks & stale responses, rate limit (with and without feasible `Retry-After`), exhausted quota, invalid key, 403, 404, 5xx, 503, empty, blocked, truncated, browser disconnect propagation, oversize body/text, cross-origin, auth, fail-closed production config, draft persistence on/off, private mode, output rendered as text.
* **10 Playwright E2E runs ✔** (desktop 1440×900 and iPhone-14 metrics) on the production build: Arabic end-to-end, English dark theme, stalled stream → labelled partial with input intact, quota error, security headers, **no horizontal scroll at 390 px** (a real overflow bug was found and fixed this way).
* **Not performed:** live Gemini quality/latency checks (no API key here — run `npm run check:model`), and **real iPhone Safari / WebKit** testing (only Chromium with iPhone viewport was available). Please check on your iPhone: keyboard open with long text, Add-to-Home-Screen, backgrounding mid-rewrite.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Server isn't fully configured" | Missing `GEMINI_API_KEY`, or production without `ACCESS_PASSWORD`+`SESSION_SECRET` (≥32 chars) or `PUBLIC_ACCESS=true`. Redeploy after setting. |
| "Rate limiting isn't configured" | Connect Upstash Redis in Vercel (or set `RATE_LIMIT_MODE=off` for a private, password-protected deployment). |
| "Gemini API key was rejected" | Key invalid/revoked, API not enabled for the project, or the deployment region isn't supported by Gemini. Create a new key in AI Studio. |
| "Quota … used up" | Daily/free-tier quota or billing cap exhausted. Not retried automatically. Wait for reset or enable billing / raise limits in AI Studio. |
| "Too many requests" | Per-minute limit (Google's or this app's). The app waits for `Retry-After` when it fits in 45 s; otherwise retry later. |
| "Model isn't available" | Model ID retired or not enabled for your key. Run `npm run check:model`; set `GEMINI_MODEL` (and optionally `GEMINI_FALLBACK_MODEL`) to a current ID from the models page. 3.8 Flash requires `GEMINI_THINKING_LEVEL=low` or higher. |
| Slow first response / timeouts on mobile data | Each attempt waits 15 s for first text, 12 s between chunks, 45 s overall. Switch to Wi-Fi, shorten the text, or keep `minimal` thinking. Budgets live in one file: `src/lib/shared/timeouts.ts` (keep `maxDuration` above `overallMs`). |
| Result labelled "Incomplete" | Stream stalled, connection dropped, page was backgrounded, or the model hit its output limit. Press **Restart** (a fresh request — never appended). |
| Vercel 504 / function timeout | Ensure the project uses Fluid Compute (default for new projects) so `maxDuration = 60` is honoured. |
| Build fails on fonts | Fonts are self-hosted via `@fontsource`; no network is needed at build. Run `npm ci` to restore them. |
| Old UI after deploy (installed app) | The service worker is network-first for pages; close and reopen the app. Bump `VERSION` in `public/sw.js` to force a cache reset. |

---

## 8. Configuration knobs worth knowing
* Limits: `LIMITS` in `src/lib/shared/options.ts` (input 8 000 chars, custom instructions 300, preserved terms 500, body 64 KB, output cap 8 192 tokens).
* System instruction: `src/lib/server/prompt.ts` (`SYSTEM_INSTRUCTION`) — tests assert its key clauses.
* `GEMINI_BASE_URL` (optional): API base URL override for a proxy; used by the E2E suite to target the local mock.
* Dev-only advisory: `npm audit` reports a `braces` issue inside ESLint tooling (dev dependency only); production dependencies audit clean.
