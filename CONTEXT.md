# Code Club Wales

A mini-site within the wider [Code Club](https://codeclub.org/en) charity. Crew members work through lessons and ship their own personal site at `<slug>.codeclub.wales`. Joining is **gated**: a person requests to join and the Organiser admits them before they become an active Crew member; separately, the Organiser verifies a member's personal site before it is published.

## Language

**Crew member**:
A person who participates in the club. The landing page already names existing ones as "Crew". Anyone can *request* to join; the **Organiser** admits them (see **Admission**). A Crew member is **pending** until admitted, then **active**.
_Avoid_: Learner (used in person, but not in the codebase), User, Account, Name (the free-text input field is a transient handle, not the canonical identity).

**Username**:
The handle a Crew member chooses at join and signs in with — the **canonical identity** of a Crew member (a Google join picks one too, in a post-auth step). Unique, normalised, semi-private. Required even when no email is held. Distinct from **display_name** (the friendly name shown in the UI, defaulted from the username) and from **slug** (the optional, public **Personal site** subdomain, claimed later).
_Avoid_: Handle, login, nickname, Name.

**Personal site**:
The site a Crew member is building, published at `<slug>.codeclub.wales` once verified. Distinct from the main `codeclub.wales` landing page.
_Avoid_: Profile, page, website (too generic).

**Verification**:
The organiser's review of a Crew member's personal site before it goes live at `<slug>.codeclub.wales`. A site exists in an unverified/draft state before this gate.
_Avoid_: Approval, moderation, review (each has slightly different connotations — verification is the chosen term).

**Organiser**:
The person who runs the club, reviews submissions, and grants admission and verification. Currently a single role (the user). Plays the same role as the "teacher" in Raspberry Pi Foundation's *Code Classroom*: stands in for the parent under UK-GDPR education exceptions when consent paperwork is collected in person.
_Avoid_: Admin, moderator, teacher.

**Admission**:
The Organiser's decision to let a person who has requested to join become an **active** Crew member. Before admission they are a **pending** Crew member, able to request but not to sign in. Distinct from **Verification**, which reviews a **Personal site**, not a person.
_Avoid_: Approval, sign-up approval, activation.

## Relationships

- A person **requests to join**; the **Organiser** grants **Admission**, making them an **active** **Crew member**
- A **Crew member** has zero or one **Personal site**
- A **Personal site** requires **Verification** by the **Organiser** before being published

## Out of scope (v1 accounts work)

- **Personal site authoring** — sites are built locally with AI assistance and pushed to GitHub for hosting. The accounts feature does not own this workflow.
- **Verification UI** — remains an out-of-band Organiser activity.
- **Organiser-provisioned accounts** — v1 is self-request + **Admission**: the Organiser admits self-requested accounts but does not create them. Organiser-*provisioned* accounts (the "Code Classroom" analogue, where the Organiser creates the login outright) remain deferred to v2.

## Data model (v1 accounts work)

- **Tables**:
  - Better Auth defaults — `user`, `session`, `account`, `verification` — kept vanilla. `user` is an auth-layer implementation detail; it has no product-facing name in the domain language.
  - `crew_member` — one row per `user`, FK to `user.id`. Holds all domain fields: `display_name`, `is_organiser` (boolean, default `false` — the Organiser role; bootstrapped from `ORGANISER_USERNAMES` at join), `admitted_at` (nullable timestamp — when the Organiser granted **Admission**; `NULL` = pending, cannot sign in), `reset_allowed_until` (nullable timestamp — an Organiser-opened 5-minute window during which the member may set their own new password), `slug` (nullable), `slug_claimed_at` (nullable), `slug_verified_at` (nullable). **No age or consent data** is held (see [ADR 0001](docs/adr/0001-no-online-consent-capture.md)).
  - `lesson_progress` — typed envelope + opaque payload:
    ```
    lesson_progress(
      crew_member_id, lesson_id,
      lesson_type,
      started_at, last_active_at, completed_at,
      payload jsonb,
      PRIMARY KEY (crew_member_id, lesson_id)
    )
    ```
    Lifecycle fields (`started_at`, `completed_at`, etc.) are first-class columns so future analytics / rewards / progress queries don't have to unwrap JSON. `payload` is whatever shape that lesson type wants. `lesson_id` is a **stable string slug baked into the lesson code** (e.g., `'phase-0-question-cards'`) — lessons are content in the SPA, not rows in a `lesson` table. Writes are **full-payload replace** on debounced save (matches the current localStorage pattern; last-write-wins per `(crew_member_id, lesson_id)` — no real-time collab to worry about).
- **Why separate `crew_member` from `user`**:
  - Domain term **Crew member** maps directly to the `crew_member` table — schema mirrors the language.
  - Insulates domain data from Better Auth schema churn (or provider swap, if it ever happens).
  - Costs an extra JOIN on reads, but every Crew member dashboard query touches both tables anyway.
- **Signup writes** both rows in a transaction (Better Auth `signUp` + `crew_member` insert).
- **Slug claim is a separate post-signup action**, not part of the signup form. Signup stays short. The marketing page's Crew list reads from `crew_member WHERE slug_verified_at IS NOT NULL`. The three states of `slug`:
  - `slug IS NULL` — hasn't claimed a personal site.
  - `slug` set + `slug_verified_at IS NULL` — claimed, awaiting Organiser verification.
  - `slug` set + `slug_verified_at` set — verified, advertised publicly.

## Architecture decisions (v1 accounts work)

- **Auth model**: **Username + password** as the primary credential (many kids have no email), **email optional**, **Google** retained as an additional credential. **Better Auth** for the auth library. Access is **gated by Admission** — a join request is inert until the Organiser admits it. **No online consent capture** (see [ADR 0001](docs/adr/0001-no-online-consent-capture.md)).
- **Join flow (v1)**: A short *request to join* form — username + password (+ optional email); `display_name` defaults from the username. Google joins authenticate first, then pick a username in a completion step. **No DOB, no parent-permission, no consent gate.** On submit the person becomes a **pending** Crew member — they **cannot sign in** until the Organiser grants **Admission**. Slug claim remains a separate post-admission action.
- **Admission enforcement**: `crew_member.admitted_at` is the gate. Better Auth's `session.create.before` hook refuses to mint a session — password sign-in, Google callback, or the auto-session at join — while `admitted_at IS NULL`; `autoSignIn` is off so a join never attempts one. The Organiser admits by stamping `admitted_at`.
- **Organiser surface**: the Organiser role is a domain flag (`crew_member.is_organiser`), **not** Better Auth's admin plugin — keeping "admin" out of the model. Organiser-only Hono routes (admit / reject pending members, reset a member's password, remove a member) check the flag; the SPA surfaces them as an **Organiser** area at `/organiser`. Server-side password resets call Better Auth's password API under the hood. First Organiser bootstraps from `ORGANISER_USERNAMES`.
- **Password reset**: a single, **email-free** path — the **Organiser-opened reset window**. The Organiser clicks "Allow reset" for a member, stamping `reset_allowed_until = now + 5 min`; while it's open, the signed-out kid sets their *own* new password on a public reset page (keyed by username), gated only by `now < reset_allowed_until`, after which the window is cleared. The Organiser never sees the password. No email-link reset — dropped deliberately so one uniform mechanism serves the email-less majority. A 4-digit code binding the window to a specific kid is a noted future add if in-person mischief ever occurs.
- **Account linking (post-join)**: in account settings a Crew member can (1) set/replace their **email** with **no verification** (contact metadata; nothing depends on it being real), and (2) **link Google** while signed in (Better Auth manual linking), after which they can sign in with password *or* Google. Distinct from "Sign in with Google" by a stranger on the login page, which is a *new pending join* (with the pick-a-username step).
- **AI features and under-13 users (design note, not a v1 decision)**: Not age-gated. Under-13 use of AI features is on-mission (sibling org runs Experience AI for ages 11–14) and permitted by both OpenAI and Anthropic for educational use with safeguards. The relevant design axis is **scoped vs open**, not age — scoped/structured AI features (e.g. "explain this code") are low-risk; open-ended chat needs content filtering and clear logging regardless of user age. Training-on-data must be off at the provider config.
- **v1 scope**: Lesson progress only — replaces `localStorage` for the question-card lesson. Personal sites remain AI-built + GitHub-hosted, outside this system.
- **Frontend**: Vite + React + TanStack Router + TanStack Query (pure SPA, no SSR). Chosen for skill transfer to a parallel work dashboard rebuild.
- **Repo layout**: pnpm-workspace monorepo with **Turborepo** (local cache only — no remote cache, no Vercel account dependency). Packages: `apps/web` (existing static marketing site), `apps/spa` (Vite + React + TanStack), `apps/api` (Hono), `packages/shared` (types, Zod schemas, Better Auth client/server type sharing). Chosen over plain pnpm for skill transfer to the work project — 3 packages won't show off Turborepo's strengths, but learning the task pipeline / input hashing model on a low-stakes codebase is the goal.
- **Backend**: Separate Hono service.
- **Backend hosting**: **Railway** — long-running container, simple UX, one-click Postgres add-on. Chosen for skill transfer to a parallel work project that will use the same platform.
- **Database**: **Railway Postgres** add-on, intra-Railway networking for sub-ms latency. ORM: **Drizzle** (type-safe, lightweight, on-pattern for the TanStack/Hono ecosystem).
- **Edge protection**: **Cloudflare in front of `api.codeclub.wales`** (free tier: WAF, rate-limit, bot protection, basic analytics). Backfills the one area Railway is meaningfully weaker than Vercel — no built-in app-layer WAF. `codeclub.wales` and `my.codeclub.wales` stay on Vercel, which provides equivalent protection natively. The public **join** endpoint additionally carries a **Cloudflare Turnstile** challenge — a purpose-built human-check on the one unauthenticated write path. Turnstile is not used elsewhere (sign-in is rate-limited at the edge; Google self-gates).
- **Email provider**: **Resend** with **React Email templates** (TSX components). Free tier (3k/mo) covers v1 by miles. Better Auth integration is documented. **Note:** with magic-link and email-link reset both dropped, v1 *auth* sends **no** email at all — Resend is reserved for future notifications, not a dependency of the sign-in/reset flows. Chosen over Postmark (the work-project incumbent) explicitly to *explore* a new vendor on a low-stakes codebase — opposite reasoning to Railway, where skill transfer was the goal.
- **PR previews**: Railway auto-spins a per-PR environment with its own ephemeral Postgres (empty by default — production data must not bleed into previews; optional volume copy if a seeded clone is wanted).
- **Scaling shape**: Vertical autoscaling is automatic on Railway. Horizontal replicas are a manual dial — fine for predictable peak days (club nights, school holidays); pre-scale before known peaks rather than chasing metric-driven HPA.
- **Local dev**: Vite + Hono run natively via `pnpm dev` from the monorepo root (Turborepo orchestrates the parallel processes). Postgres runs in Docker (`docker compose up -d db`), version pinned to match Railway's Postgres add-on (currently **Postgres 16**) so query-plan drift bugs can't exist. Resend in **sandbox mode** locally — no SMTP server needed, emails previewed in Resend dashboard.
- **DB migrations**: **`drizzle-kit push`** for local dev (schema sync, no migration files during exploration), **`drizzle-kit migrate`** with versioned migration files for production / preview environments. Migrations run as an **API startup hook** inside the Railway container (a one-line `migrate.ts` invoked before `serve()`) — no separate CI step against a remote DB.
- **CI/CD**:
  - **Deploys**: pure platform git integrations. Vercel watches the repo and deploys `apps/web` + `apps/spa` on push to `main`; Railway watches and deploys `apps/api`. PR previews auto-spin on both platforms (per [[#PR previews]]). No GitHub Actions involved in actual deploys.
  - **CI gate**: `.github/workflows/ci.yml` runs `pnpm turbo run lint typecheck test --filter=...[HEAD^1]` on PR — only touched packages and their dependents. Blocks merge if anything fails.
  - **Branch protection**: `main` is protected — green CI required, all changes go through PR (self-reviewed is fine).
  - **API tests**: integration tests against an ephemeral Postgres (Testcontainers or `pg-mem`). No unit-tests-for-tests'-sake.
- **Site shape**: Surfaces under one root domain:
  - `codeclub.wales` — hand-coded static marketing/landing page (preserves existing design: coral/gold/sage palette, grain texture, three font families, Crew names).
  - `my.codeclub.wales` — the React SPA. Owns auth, lessons, and all stateful/interactive features.
  - `api.codeclub.wales` — separate Hono backend. Distinct subdomain (not same-origin path) so its deploy lifecycle stays decoupled from the SPA.
  - `<slug>.codeclub.wales` — existing personal sites (Alex, Nathan, Nicholas). Status quo for now.
- **Session cookie**: scoped to `.codeclub.wales` so it's valid across `my.*` and `api.*`. Personal sites can't read HttpOnly cookies, so there is no leak risk to user-generated HTML.
- **Reserved subdomain denylist** (enforced at signup, not just by convention): `www`, `my`, `api`, `auth`, `mail`, `admin`, `docs`, `crew`, `learn`, plus anything else actually deployed.

## Interim auth gate (shipped ahead of the full v1)

Shipped on the **current static Vercel site**, before the monorepo/Hono/Railway build above exists, to stop the open AI endpoint (`/api/grill`) from being abused. It is a deliberate, minimal subset of the v1 auth model — not a competing design.

- **Closed access, not open signup.** Unlike the v1 plan ("self-signup is open"), this gate is an **email allow-list**: only addresses in the `ALLOWED_EMAILS` env var can sign in *at all*. Rationale — protecting paid AI usage for a 3-kid club is the immediate need; open signup is deferred to the real v1. When v1 lands, the allow-list either drops away (back to open signup) or becomes the v2 "Organiser-provisioned accounts" mechanism.
- **Library**: **Better Auth** (same choice as v1, so it carries forward). Magic-link sign-in only — no passwords (kid-friendly), no Google yet.
- **Storage**: a free **Neon** Postgres (serverless, suits Vercel functions) holding Better Auth's stock `user`/`session`/`account`/`verification` tables. No `crew_member`/`lesson_progress` yet — those arrive with the v1 data model.
- **Wiring**:
  - `lib/auth.js` — the Better Auth instance + allow-list gate + Resend magic-link email. Single source of truth.
  - `api/auth/[...all].js` — mounts Better Auth at `/api/auth/*` (Vercel catch-all).
  - `api/grill.js` — now requires a valid session (`auth.api.getSession`); returns 401 otherwise. This is the actual security boundary for the AI endpoint.
  - `middleware.js` — Vercel Edge Middleware protecting the **whole `/lessons/*` route set** (not just the AI lesson). Optimistic session-cookie check at the edge; redirects to `/login?next=<page>` when absent. New lessons are covered automatically — no per-page gate code. The Next.js-middleware-style "protect a set of routes" pattern, on a non-Next static site.
  - `login.html` — minimal magic-link request page.
- **Allow-list enforcement** is in two layers in `lib/auth.js`: a `hooks.before` middleware rejects any non-listed email with a 403 *before* a link is generated/sent, and a `databaseHooks.user.create.before` refuses to create a user row as defence in depth.
- **Session cookie** behaves as the v1 plan intends (scoped to the site origin); same-origin here since everything is on `codeclub.wales` for now.
- **Sunset**: the interim gate is a **bridge**, not a parallel design. When v1 ships it retires wholesale — the `ALLOWED_EMAILS` allow-list, magic-link sign-in, *and* the later-added shared weekly quick-code (`LESSON_CODE` / `cc_access`, in `lib/access-code.js` + `api/access.js`) all go — replaced by per-kid **username + password** behind **Admission**. The shared code lives on only until v1 is the real site.

## localStorage migration

On first signup, the SPA silently migrates any `codeclub-phase0-cards-solo` legacy data into the new `lesson_progress` table.

- **Client trigger**: if (a) the legacy key exists in `localStorage` AND (b) no migration flag is set, fire `POST /api/lesson-progress/migrate` with `{ lesson_id: 'phase-0-question-cards', payload, started_at }`.
- **Server idempotency**: `INSERT ... ON CONFLICT (crew_member_id, lesson_id) DO NOTHING`. Replaying the request is a no-op. Migration **does not overwrite** existing progress (if the Crew member already has a row for that lesson from another device, the legacy snapshot loses).
- **Client flag**: after a successful response, set a single (not per-user) flag `codeclub-phase0-cards-migrated = '<timestamp>'` so subsequent signups on the same browser don't refire.
- **Do NOT delete** the legacy `localStorage` key — keep as a safety net. It's KB-scale and will go progressively stale, but the user explicitly chose to preserve it just in case.

### Known edge: shared-family laptop

A meaningful chunk of the audience uses a parent's device. With the first-comer flag pattern above, the first signup on a browser migrates the localStorage data; subsequent signups on the same browser start fresh. This is the right tradeoff (avoids accidentally giving sibling B sibling A's progress) but is worth being aware of — siblings will see asymmetric first-run behaviour based on signup order.

## Grill-me lesson (Phase 1)

The second lesson — `lessons/phase-1-grill-me.html` — runs a Matt-Pocock-style "grill me" interview over the answers from the Question Cards lesson, powered by an LLM via OpenRouter. Designed to upgrade to Claude Sonnet later with **no code change** (just `GRILL_MODEL`).

**Model choice (learned the hard way):** OpenRouter's `:free` model tier is heavily rate-limited upstream — it returns 429 within a handful of requests and stays throttled, so it is **not usable for a live club**. The deployed config uses the **paid** `meta-llama/llama-3.3-70b-instruct` (~$0.13/M tokens ≈ half a cent per grilling session per kid; a club night is a few cents). The code's *fallback* default is still the `:free` id so a fresh clone never spends by surprise — but any real deployment must set `GRILL_MODEL` to a paid id. Verified end-to-end (opening turn / follow-up / final plan) against the paid Llama variant.

- **Input**: reads the Phase 0 answers straight from `localStorage` key `codeclub-phase0-cards-solo` (same shape lesson 1 writes). If none exist on the device (shared-family-laptop case — see [[#Known edge: shared-family laptop]]), it falls back to a paste/describe box.
- **Output**: the `summary` mode returns a **structured JSON** game plan (`gameName, tagline, bigIdea, coreLoop, mainAction, howYouWin, v1, notInV1[], nextStep, hypeLine`), which the lesson pours into a designed, celebratory **Game Plan poster** — rendered inline and offered as a **Download** (a self-contained standalone HTML keepsake, built by the same template functions) and **Print**. Saved to `localStorage` key `codeclub-phase1-grill-solo` (`{ name, qa, messages, plan, planRaw, updatedAt }`). If the model returns non-JSON, the lesson falls back to rendering `planRaw` as Markdown so the finish step never hard-fails.
- **First server-side code in the repo.** The lesson calls `POST /api/grill` — a **zero-dependency Vercel serverless function** (`api/grill.js`, plain Node `fetch`, no npm install, no `package.json`). It speaks the **OpenAI-compatible** chat-completions shape, so it works against OpenRouter / Groq / OpenAI / direct providers unchanged. The function is the *only* place the API key lives: `GRILL_API_KEY` is a Vercel env var, never shipped to the browser (see `.env.example`).
- **Provider is env-config, not hardcoded**: `GRILL_API_KEY`, `GRILL_BASE_URL` (default `https://openrouter.ai/api/v1`), `GRILL_MODEL` (default the free Llama). Moving to paid Claude is just `GRILL_MODEL=anthropic/claude-sonnet-4-6` on the same OpenRouter key — the proxy code is identical.
- **Why this is a deliberate, minimal exception** to the "hand-coded static site" shape: it's a single stateless proxy with no DB and no auth, sized for three kids behind the Organiser. It does **not** pre-empt the planned Hono/Railway backend.
- **Latency/abuse knobs**: grill turns use `max_tokens: 700` (snappy, inside Vercel's function timeout); the final plan (JSON) uses `max_tokens: 1800`. Transcript is capped server-side (`MAX_MESSAGES` 60 / `MAX_CHARS` 6000). All model/user values are HTML-escaped before going into the poster.

## Deferred decisions (recorded for later)

- **Personal site URL pattern**: when we migrate, new pattern is `<slug>.crew.codeclub.wales` (not the current `<slug>.codeclub.wales`).
  - Why: single wildcard DNS + SSL record (`*.crew.codeclub.wales → Vercel`), so new Crew members go live without per-signup DNS work. Cleanly separates Crew namespace from app infrastructure.
  - Migration cost: existing three Crew (`alex-c`, `nathan-h`, `nicholas-h`) need DNS + Vercel reconfig, landing-page links updated, 301 redirects from old URLs to preserve any external links they've shared.
  - Parked: not part of v1 accounts work; revisit when there's a natural prompt (new Crew member signup, or the slug-collision pain bites).

## Flagged ambiguities

- "Account" was raised as a feature name. It maps to **Crew member** — auth attaches credentials to a Crew member, it does not create a separate "Account" concept.
- **Resolved:** the canonical identity of a Crew member is their **Username** (chosen at join; Google joins pick one too). The free-text "Name" in `lessons/phase-0-question-cards.html` is not identity — it now feeds **display_name** (the shown label), which defaults from the username.
- **Credential model:** primary credential is **username + password**; **email is optional** metadata (synthesised internally when absent, enables self-service reset); **Google** sign-in is retained as an additional credential. _Was_: the v1 sketch said "email + Google" with no username — superseded by the username-first model above.
