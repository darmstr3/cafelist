# Cafelist Cowork — Execution Plan (Profiles → Plans → Invites)

_Owner: Donovan • Project Lead Agent: Claude • Drafted: 2026-05-24_

A practical operating doc for the next major product expansion. Read in order; nothing here is decorative. Lives next to `LABS_V2_PLAN.md` and follows the same operating manual conventions (ADR voice, additive-only DB, feature-flagged ship, every ticket is a PR).

---

## 1. Product mission (one paragraph)

Cafelist today is a **single-shot recommender**: open the app, find a café, leave. The next product layer turns it into a **weekly remote-work planning + light social tool**. A user signs up, favorites cafés, builds a 7-day "this week's cowork plan" (Monday at Bushwick spot A, Tuesday at FiDi spot B), and can optionally invite a friend to join them at a planned slot. The retention loop moves from "1 search per visit" to "I open Cafelist on Sunday night to lay out my week, and again any time a friend RSVPs." The existing single-shot `/` and `/labs` surfaces stay; they become the **entry points that feed the plan**, not destinations in themselves.

---

## 2. Phasing at a glance

Three phases, strict dependency order. Each phase ships an end-to-end loop a user can feel; nothing is half-built behind a flag in production.

| Phase | Loop it ships | Why this order | Estimated PRs |
|---|---|---|---|
| **P1 — Accounts + Profile** | Sign up → see "your dashboard" (empty state w/ a CTA) | Nothing else works without an identity. Migrates the admin gate without breaking it. | 6–8 PRs |
| **P2 — Favorites + Weekly Plan** | Favorite a café → drag it onto a weekday → see the week | This is the **retention loop**. Single highest-leverage phase. | 7–9 PRs |
| **P3 — Invite a Friend** | Send a shareable invite → friend RSVPs → both see it | Social viral loop, but only meaningful once a plan exists to invite *to*. | 5–7 PRs |

Total: ~20 PRs across roughly 6–8 weeks at the current shipping cadence (≥3 PRs/wk per `LABS_V2_PLAN.md §6`). Each phase ends with a Friday tag + Loom outline + SHIP_LOG entry.

---

## 3. Explicitly NOT building yet

Saving present-Donovan an argument with future-Donovan.

- **Push notifications / native mobile.** Mobile web + transactional email only.
- **Group plans (>2 people per slot).** Phase 3 is 1:1 invites only. Group cowork is V2 of the social layer, not the first cut.
- **Calendar sync (Google/Apple).** Read-only `.ics` export is the most we do; bidirectional sync is a whole product.
- **Real-time presence ("Alex is here now").** Needs check-in flow + privacy primitives we don't have.
- **Following / activity feed.** Social graph creates moderation work. Invites are 1:1 and link-based, no public graph.
- **Profile photos with uploads.** Initials avatar or Gravatar only. Storage + moderation deferred.
- **Public profiles indexable by Google.** Profiles are app-internal until P3 ships and we know what's actually shared.
- **Email digests ("here's your week").** Phase 4+. Send only transactional email in P1–P3.
- **Replacing the admin gate.** The Basic-Auth gate on `/admin/*` and `/api/labs/*` keeps working unchanged through all three phases. See §6 ADR-COWORK-0002.
- **A reviews-by-logged-in-user upgrade.** Tempting once accounts exist, but it changes the moderation queue and the public-write RLS policy at the same time. Separate project.

---

## 4. Architectural rules (non-negotiable, restated)

These come from `LABS_V2_PLAN.md §16`, `CLAUDE.md`/`AGENTS.md`, and `DECISION_LOG` ADRs 0001–0005. Every ticket below assumes them.

1. **`main` = production.** Vercel auto-deploys. PR + green CI required.
2. **Feature branches per ticket.** Pattern: `feat/cowork-auth-bootstrap`, `feat/cowork-favorites-table`.
3. **Feature flags gate every user-visible surface.** New flags introduced here:
   - `NEXT_PUBLIC_COWORK_ACCOUNTS` / `COWORK_ACCOUNTS_ENABLED` (P1)
   - `NEXT_PUBLIC_COWORK_PLAN` / `COWORK_PLAN_ENABLED` (P2)
   - `NEXT_PUBLIC_COWORK_INVITES` / `COWORK_INVITES_ENABLED` (P3)
   Mirror the `feature-flags.ts` pattern at `src/lib/labs/feature-flags.ts` — server reads server-only env, client reads `NEXT_PUBLIC_` var.
4. **Database changes are additive.** Add columns/tables; never drop or rename inside a feature PR. Schema migrations live in `supabase/migrations/` with a date-prefixed filename mirroring `20260514_add_workability_score.sql`. RLS enabled on every new table from day one.
5. **The existing `/` (directory) and `/labs` (recommender) keep working flag-off and flag-on.** A signed-out user on `cafelist.app` sees exactly today's product.
6. **`/api/health` is the canary** — verify before every Cowork PR merge that `getSpots` still returns 200 (per `LABS_V2_PLAN.md §16 rule 7`).
7. **Per-PR rollback line** in every description: "to revert: flip `<FLAG>=off` in Vercel" or "to revert: `git revert <sha>` (migration is additive, no rollback needed)."

---

## 5. Recommendation: start with **Phase 1 — Accounts**

Even though Phase 2 is the highest-value loop, Phase 1 unblocks everything. The constraints:

- **You can't ship favorites without `user_id`**. Doing it anonymously-keyed-by-cookie is throwaway work and leaks data on device-switch — a footgun for the social phase.
- **The admin gate is on `/labs`, not on user-facing surfaces.** A new `/me` route added today is the first user-facing authenticated surface in the codebase; getting the auth foundation right *once* costs less than retrofitting it during P2.
- **P1 ships a credible "you have an account now" loop fast** (sign up → confirm email → see empty dashboard) without needing any new ranking, recommendation, or social design. That's a clean 2-week beat to maintain the `LABS_V2_PLAN.md §6` Friday-tag cadence.
- **The smallest P1 also lets us add a Favorites stub in the same dashboard later without route changes.** `/me` is the page; Favorites is the first widget on it.

**Recommendation: ship `feat/cowork-auth-bootstrap` (ticket C-1 below) as the next branch.** Everything else queues behind it.

---

## 6. Auth strategy decision (read this carefully before locking it)

**Recommendation: Supabase Auth, magic-link primary, Google OAuth as a P2 add-on.** Below is the full tradeoff, written as an ADR-style block so it can be lifted into `DECISION_LOG.md` once you decide.

### ADR-COWORK-0001 — Use Supabase Auth (magic-link first), not Clerk and not roll-your-own

**Date:** _TBD on confirmation_
**Status:** Proposed — needs Donovan's sign-off before C-1 starts

**Context.** Cafelist already runs on Supabase for `spots`, `reviews`, `agent_query_logs`, etc. The current "auth" is admin-only HTTP Basic Auth in `src/middleware.ts`. We need real end-user auth for Phases 1–3. Options:

| Option | Pros | Cons |
|---|---|---|
| **Supabase Auth** | Already in stack. Free up to 50k MAU. RLS integration is native — `auth.uid()` is the policy primitive we'd write against anyway. `@supabase/ssr` is **already in `package.json`** (saw `^0.10.2` — that's the Next.js App Router helper). Magic-link, OAuth, passwords all built in. | Less polished hosted UI than Clerk. Some email-deliverability gotchas with the default SMTP. |
| **Clerk** | Best-in-class hosted UI, easy social login matrix, great DX. | A new vendor + a new bill at scale ($25/mo at the first paid tier kicks in fast for a public site). Doesn't integrate with Supabase RLS without webhook plumbing to sync `users` → `auth.users`. Adds a second source of truth for "who is this person." |
| **Roll-your-own** | Full control. | Don't. Out of scope for a solo operator. Sessions, password hashing, email verification, CSRF, rate-limit-the-magic-link-endpoint — every one is a footgun. |

**Decision.** Supabase Auth. Start with **magic-link only** (email → click → signed in) — zero password UX, lowest friction, no "forgot password" flow to build. Add Google OAuth in P2 when the favorites loop is live and a "sign in faster" payoff is visible.

**Why magic-link primary:**
- One UI to build (an email input + a "we sent you a link" state).
- No password-management edge cases.
- Email confirmation and login are the same flow → no separate "verify your email" gate.
- Maps cleanly to Supabase's `signInWithOtp()`.

**Alternatives considered.**
- _Google OAuth as primary._ Faster sign-in once enabled, but requires Google Cloud project setup, OAuth consent screen review for a public app, and excludes anyone who'd rather not link Google. Magic-link works for everyone; OAuth is purely an optimization.
- _Email + password._ Most users still expect it, but adds 4 flows (signup, login, forgot, reset) and a hashing dependency. Defer until users ask.

**Consequences.**
- **Existing admin gate stays.** The Basic-Auth middleware keeps protecting `/admin/*` and `/api/labs/*`. Logged-in user identity does NOT confer admin. Admin and end-user auth are deliberately separate systems through P3.
- **`supabase` client (anon key) becomes the auth-aware client** for end-user surfaces; `supabaseAdmin` (service role) stays for admin paths only.
- **Email deliverability is now a production concern.** Supabase's default SMTP is rate-limited and lands in spam. P1 ticket C-3 wires Resend (or Postmark) as the custom SMTP provider before any beta user touches it.

**Revisit when.** A second admin operator appears (then we converge admin onto Supabase Auth with a role claim), OR magic-link deliverability hits a wall at ~100+ users/wk (then we add password as a fallback).

---

### ADR-COWORK-0002 — Admin Basic Auth and end-user Supabase Auth coexist; do not merge them

**Date:** _TBD on confirmation_
**Status:** Proposed

**Context.** Tempting to "upgrade" the admin gate to Supabase Auth + a role claim at the same time we add end-user auth. Don't.

**Decision.** Two completely separate auth systems through Phase 3:
- **Admin:** HTTP Basic Auth via `src/middleware.ts`. Protects `/admin/*`, `/api/import`, `/api/labs/*`, write methods on `/api/spots/*` and `/api/reviews/*`. One operator (Donovan).
- **End-user:** Supabase Auth (magic-link). Protects `/me`, `/plan`, `/api/cowork/*`. Many users.

The matchers in `middleware.ts` already explicitly avoid `/`, `/spot/*`, `/submit`, `/api/spots` GET, `/api/reviews` GET — so the gate is opt-in by path. New end-user paths are NOT added to the matcher.

**Alternatives considered.**
- _One auth system with roles._ Cleaner long-term, but the migration concentrates risk in a single PR (admin gate change + new user-facing surface). Splitting them keeps each PR boring.

**Consequences.**
- An admin operator who wants to use a personal end-user account does so as a separate sign-in. Fine for now.
- Two `.env` concerns: `ADMIN_PASSWORD` (admin), `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (end-user).

**Revisit when.** Either (a) a second admin operator joins, or (b) we want to give admins a unified inbox where "logged-in operator" implies "can approve spots." That's the right moment to unify, not now.

---

## 7. Phase 1 — Accounts + Profile (P1)

### 7.1 Scope (what's IN)

- **Sign up + sign in** via magic-link. Single `/login` page, one input, one button.
- **Session management** via `@supabase/ssr` (already a dep). Server components read the session for auth-gated rendering; client components for live state.
- **`profiles` table** keyed by `auth.users.id`. Stores: display name, home city (optional), timezone (optional), `created_at`.
- **Self-serve profile edit** at `/me/settings` — display name + home city.
- **`/me` dashboard** — empty-state-only in P1. Renders "You're signed in as {display_name}. We don't have anything to show you yet — favorites and plans are coming." Acts as the landing target after login.
- **Sign-out** in the top nav.
- **Custom SMTP** wired to a transactional email provider (Resend recommended — easiest Vercel/Next stack fit) so magic-link emails don't land in spam.

### 7.2 Scope (what's DEFERRED to P2+)

- Profile photos / avatars (initials only in P1).
- "Forgot password" — N/A with magic-link.
- Social login (Google) — P2 ticket once we know magic-link conversion rate.
- Account deletion flow — P3 ticket; in P1, admin-only soft-delete via SQL.
- Username uniqueness (display_name is just a label, not a handle).
- Public profile pages — P3 only.

### 7.3 DB schema changes (additive, RLS-enabled)

New migration: `supabase/migrations/20260601_cowork_profiles.sql` (date is illustrative — use the day the PR lands).

```sql
-- 20260601 — Cowork Phase 1: end-user profiles.
-- Each row in profiles 1:1 with auth.users via FK on id. Public-read
-- (so a future P3 "shared plan" surface can show the inviter's display
-- name without an extra auth round-trip), but write-only by the owner.

CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  home_city       TEXT,                                    -- nullable; for P2 "default plan city"
  timezone        TEXT,                                    -- nullable; IANA, e.g. "America/New_York"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Public read (display_name only is the practical use case, but RLS
-- is row-level; column-level masking comes from the SELECT statement
-- in the API. Document this so a future contributor doesn't add a
-- PII column without noticing.)
CREATE POLICY "profiles_public_read" ON profiles
  FOR SELECT USING (true);

-- Owners write their own row.
CREATE POLICY "profiles_self_insert" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Auto-create a profiles row when a new auth.users row appears.
-- Display name defaults to the email local-part; user can edit at /me/settings.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

**Why public-read on `profiles`:** P3 invites show the inviter's display name to anyone with the invite link. Easier to allow read here than to write a `SECURITY DEFINER` function per call.

**Open question for Donovan:** is "display name is world-readable" acceptable? Default position is yes (it's how you appear to friends you invite). If not, we restrict to `SELECT` only on rows visible through an invite — adds plumbing.

### 7.4 New files

- `src/lib/cowork/feature-flags.ts` — mirror of `src/lib/labs/feature-flags.ts`. Three flags total across P1–P3; one file, three exports.
- `src/lib/cowork/auth.ts` — server-side `getSession()` and `getProfile()` helpers wrapping `@supabase/ssr` `createServerClient`.
- `src/lib/cowork/profiles.ts` — `getProfileById(id)`, `updateProfile(id, patch)`. Mirrors the shape of `src/lib/spots.ts` so the codebase has one data-access pattern.
- `src/app/login/page.tsx` — server component shell + client form. Magic-link only.
- `src/app/login/actions.ts` — Next 16 Server Action that calls `supabase.auth.signInWithOtp(...)`.
- `src/app/auth/callback/route.ts` — Supabase exchange endpoint (`/auth/callback` is the conventional landing URL for magic-link clicks).
- `src/app/me/page.tsx` — server component, reads session, renders empty-state dashboard.
- `src/app/me/settings/page.tsx` — server-rendered form + Server Action for `display_name` + `home_city`.
- `src/app/me/_components/SignOutButton.tsx` — small client component.
- `src/components/cowork/AuthNav.tsx` — replaces the hard-coded right-side actions block in `src/app/page.tsx`. Renders either "Sign in" or "Hi, {display_name} · Sign out" depending on session.
- `src/types/profile.ts` — `Profile`, `ProfilePatch`. Mirrors `src/types/index.ts` for `Spot`.

### 7.5 Existing files that change

| File | Change | Risk |
|---|---|---|
| `src/middleware.ts` | NO CHANGE in P1. Admin gate is unchanged. Add a comment block at top explicitly stating that end-user auth is a separate system (per ADR-COWORK-0002). | Low — comment only. |
| `src/app/page.tsx` | Replace the hard-coded right-side `<Link href="/submit">…` block with `<AuthNav />`. Behind `NEXT_PUBLIC_COWORK_ACCOUNTS`: flag-off, the nav renders exactly today's "Submit a spot" link with no auth surface. | Medium — every visitor sees this nav. The flag default protects prod. |
| `src/app/layout.tsx` | No structural change, but `metadata` may need a `viewport` tweak if the auth surfaces shift layout on mobile. Verify on preview before merge. | Low. |
| `src/lib/supabase.ts` | Add a third export: `createSupabaseServerClient()` that wraps `@supabase/ssr`'s `createServerClient` with the Next.js `cookies()` integration. **Do not** modify the existing `supabase` or `supabaseAdmin` exports. | Low — additive. |
| `package.json` | No new deps (already have `@supabase/ssr`). Add `"@supabase/ssr"` to a `verified` comment in the file if helpful. | None. |
| `.env.local.example` | Document `NEXT_PUBLIC_COWORK_ACCOUNTS`, `COWORK_ACCOUNTS_ENABLED`, and `RESEND_API_KEY` (or chosen provider). | None. |

### 7.6 P1 ticket breakdown

Each is one branch, one PR. Branch names suggested.

#### C-1 chore(cowork): wire @supabase/ssr server client and auth flag
- **Branch:** `feat/cowork-auth-bootstrap`
- **What:** Adds `src/lib/cowork/feature-flags.ts`, `src/lib/cowork/auth.ts`, the `createSupabaseServerClient()` export, and `.env.local.example` updates.
- **Why:** Foundation. Nothing else in P1 compiles without it.
- **Acceptance:**
  - `isCoworkAccountsEnabled()` returns false in prod env vars, true in preview.
  - `getSession()` returns `null` for a fresh request; doesn't throw.
  - `npm run lint` and `tsc --noEmit` clean.
- **Risk:** None — no UI surface yet. Rollback = revert; no migration.

#### C-2 feat(db): profiles table + handle_new_user trigger
- **Branch:** `feat/cowork-profiles-table`
- **What:** The migration in §7.3. Apply via the Supabase MCP `apply_migration` (same flow as `20260514_add_workability_score.sql`).
- **Acceptance:**
  - Migration applied; `\d profiles` shows the table.
  - Inserting a row in `auth.users` (via the Supabase dashboard "Invite user" or `supabase.auth.admin.createUser`) auto-creates the matching `profiles` row.
  - RLS prevents user A from updating user B's row (verified via two anon-key sessions in a small test script).
- **Risk:** Additive — drop-safe to revert with a single `DROP TABLE profiles CASCADE`. Note in PR description.

#### C-3 chore(infra): custom SMTP via Resend
- **Branch:** `chore/cowork-resend-smtp`
- **What:** Sign up for Resend (free tier covers 3k emails/mo), verify a domain or use the Resend onboarding domain, paste SMTP credentials into the Supabase project's Auth → SMTP settings. **No app code change.** Document the choice in `DECISION_LOG.md` as ADR-COWORK-0003 (or similar).
- **Why:** Supabase's default SMTP rate-limits to 2/hour and frequently spam-filters. We hit the wall on the first beta tester otherwise.
- **Acceptance:** Trigger a magic-link from a clean browser; email lands in inbox (not spam) within 60 seconds, from a sender that says `noreply@cafelist.app` or similar.
- **Risk:** Operational only — easy revert by clearing the SMTP override in Supabase.

#### C-4 feat(auth): /login page with magic-link
- **Branch:** `feat/cowork-login-page`
- **What:** `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/auth/callback/route.ts`. The page is two states: input form, and "we sent you a link — check {email}" confirmation.
- **Acceptance:**
  - Submitting an email triggers `signInWithOtp`; user receives an email; clicking the link redirects to `/me`.
  - Re-submitting on the same page rate-limits visibly (UI shows "we just sent one — try again in 30 seconds").
  - Honeypot field or `headers().get('user-agent')` check to discourage trivial bot abuse (optional, surface in PR for discussion).
- **Risk:** Medium — first user-facing auth surface. Flag-gated. Rollback: flip `NEXT_PUBLIC_COWORK_ACCOUNTS=off`.

#### C-5 feat(me): /me empty-state dashboard + sign-out
- **Branch:** `feat/cowork-me-dashboard`
- **What:** `src/app/me/page.tsx` + `SignOutButton`. Server-component reads session via `getSession()`. Redirects to `/login` if absent. Renders display name and a friendly "favorites and plans are coming" empty state — links to `/` and `/labs`.
- **Acceptance:**
  - Signed-out user hitting `/me` → 302 to `/login?next=/me`.
  - Signed-in user sees their display name. Sign-out works and lands back on `/`.
- **Risk:** Low.

#### C-6 feat(me): /me/settings to edit display_name and home_city
- **Branch:** `feat/cowork-profile-settings`
- **What:** Server-rendered form + Server Action that calls `updateProfile()`. Validates `display_name` length 1–60, `home_city` optional, trimmed.
- **Acceptance:** Editing and submitting persists; reloading `/me` shows the new name.
- **Risk:** Low.

#### C-7 feat(nav): AuthNav swap on home + spot pages
- **Branch:** `feat/cowork-authnav`
- **What:** Replace the hardcoded right-side block in `src/app/page.tsx` and `src/app/spot/[id]/page.tsx`'s top bar with `<AuthNav />`. Flag-off renders today's nav (one "Submit a spot" link); flag-on renders auth-aware nav.
- **Acceptance:**
  - With `NEXT_PUBLIC_COWORK_ACCOUNTS=off`, the home page is **byte-identical** in the nav region to today.
  - With it on, signed-out shows "Sign in"; signed-in shows display name + dropdown with "Settings · Sign out."
- **Risk:** Medium — every visitor sees this. Flag-gated. Verify both states on preview before merge.

#### C-8 docs: ADR-COWORK-0001 & 0002 + Cowork README section
- **Branch:** `docs/cowork-adrs`
- **What:** Append ADR-COWORK-0001 (Supabase Auth) and ADR-COWORK-0002 (auth separation) to `DECISION_LOG.md`. Add a "Cowork" section to README linking to `COWORK_PLAN.md`. SHIP_LOG entry for the P1 release.
- **Acceptance:** A recruiter skimming `DECISION_LOG.md` sees the auth tradeoff written up.
- **Risk:** None.

### 7.7 P1 risks & open questions

| Risk / question | Owner decision needed | Default if undecided |
|---|---|---|
| Magic-link spam folder rate on Gmail / Outlook | Test C-3 thoroughly | Add a "didn't get it? check spam" hint on the confirmation screen |
| `profiles.display_name` collisions across users | Donovan: do you want uniqueness? | No uniqueness in P1 (it's a label, not a handle) |
| Should `home_city` be a controlled select against `getCities()` output, or a free-text input? | Donovan | Free-text + an autocomplete from `getCities()` in P2 |
| Email confirmation language — "Click to sign in" vs. "Click to confirm" | Tone call | "Click to sign in to Cafelist" — single-purpose |
| Resend free tier (3k/mo) headroom | Watch metric in admin/ops in P2 | Upgrade when we cross 2k/mo |
| Does the existing `getSpots`'s use of `supabase` (anon key) need RLS verification once `profiles` adds a policy graph? | Yes — verify `/api/health` after migration | None expected; `spots` policies are independent |

### 7.8 P1 Definition of Done

- [ ] Signed-out user on `cafelist.app/` sees exactly today's UI (flag-off check).
- [ ] Signed-out user on `cafelist.app/` (flag-on preview) sees a "Sign in" link in the top-right.
- [ ] Signing up via magic-link lands on `/me` within 90 seconds end-to-end.
- [ ] `/me/settings` saves and reloads.
- [ ] `/api/health` returns 200 immediately after migration.
- [ ] Admin gate on `/admin`, `/labs`, `/api/labs/*` is **unchanged** (Basic Auth still prompts; logged-in end-user does not bypass).
- [ ] `DECISION_LOG.md` has ADR-COWORK-0001 and -0002.
- [ ] One SHIP_LOG entry tagged `v0.3.0-cowork-accounts` (or current numbering).

---

## 8. Phase 2 — Favorites + Weekly Plan (P2)

### 8.1 Scope (what's IN)

- **Favorite a café** from a SpotCard (heart button) and from the `/labs` recommendation card. Persists per user.
- **`/me/favorites`** — list of favorited cafés with quick-actions ("plan for Tuesday").
- **`/plan` page** — the weekly cowork plan: 7-day grid (Sun–Sat) keyed to a specific ISO week. Each day holds zero or one planned slot. A planned slot is a (cafe_id, weekday, start_time?, end_time?, note?) tuple.
- **"Save to plan" affordance everywhere a café surfaces:** SpotCard, `/spot/[id]`, RecommendationCard on `/labs`. Opens a tiny popover: pick a day, optional time range, save.
- **Move/remove from plan** on `/plan`. No drag-and-drop in P2 — keyboard- and touch-accessible click-to-pick-day pattern. Drag/drop is a P2.1 polish ticket.
- **Empty-state on `/plan`** — friendly "no plan yet, here's how to start" with deep links to `/`, `/me/favorites`, and `/labs`.
- **Multi-week navigation** — prev/next week, "this week" reset. Only the current ISO week and the next two are visitable in P2.
- **Plan visible only to its owner** in P2. (P3 changes this for plans with invites.)

### 8.2 Scope (what's DEFERRED to P2.1 or later)

- Drag-and-drop reorder.
- Multiple slots per day (P2.1; the schema below supports it via a composite key, but UI exposes one slot/day).
- `.ics` export of the week.
- Plan templates ("repeat this plan every week").
- Notifications (none of any kind in P2).
- Recurring favorites ("always plan FiDi spot on Mondays").
- A map view of the week.

### 8.3 DB schema changes (additive, RLS-enabled)

New migration: `supabase/migrations/20260615_cowork_favorites_and_plan.sql`.

```sql
-- 20260615 — Cowork Phase 2: favorites + weekly plan.

-- ── FAVORITES ────────────────────────────────────────────────
-- One row per (user, spot). Idempotent on (user_id, spot_id) so a
-- repeated "favorite" tap is a no-op rather than an error.

CREATE TABLE IF NOT EXISTS favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spot_id     UUID NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  note        TEXT,                                  -- optional "why I saved this"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, spot_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, created_at DESC);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_self_read" ON favorites
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "favorites_self_insert" ON favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "favorites_self_delete" ON favorites
  FOR DELETE USING (auth.uid() = user_id);

-- ── WEEKLY PLAN ──────────────────────────────────────────────
-- A "plan_slot" is one planned cowork session: a (user, iso_week,
-- weekday, spot) tuple, with optional start/end. The composite
-- design (no separate "plan" entity) keeps Phase 2 small — there
-- isn't a "plan" record with a title; the plan IS the set of slots
-- for a given (user, iso_week).
--
-- iso_week is stored as a TEXT in 'YYYY-Www' form (e.g. '2026-W22')
-- to avoid timezone confusion. Computed client-side from the user's
-- profile.timezone at the moment they click "Save to Tuesday."

CREATE TABLE IF NOT EXISTS plan_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  iso_week     TEXT NOT NULL CHECK (iso_week ~ '^\d{4}-W\d{2}$'),
  weekday      SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0=Sun, 6=Sat
  spot_id      UUID NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  start_time   TIME,                                                 -- nullable
  end_time     TIME,                                                 -- nullable
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One slot per (user, week, weekday) for P2. To support multiple
-- slots/day in P2.1, drop this constraint and key on a slot_index.
CREATE UNIQUE INDEX IF NOT EXISTS plan_slots_one_per_day
  ON plan_slots(user_id, iso_week, weekday);

CREATE INDEX IF NOT EXISTS idx_plan_slots_user_week
  ON plan_slots(user_id, iso_week);

CREATE TRIGGER plan_slots_updated_at
  BEFORE UPDATE ON plan_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE plan_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_slots_self_read" ON plan_slots
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "plan_slots_self_write" ON plan_slots
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plan_slots_self_update" ON plan_slots
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plan_slots_self_delete" ON plan_slots
  FOR DELETE USING (auth.uid() = user_id);
```

**Why no `plans` parent table:** A "plan" in P2 is just "all the slots for one (user, iso_week)." Modeling it as a parent record would create empty parents and orphan-cleanup work. If P3 invites need a stable "plan identity" to share, we promote the (user, iso_week) tuple to its own table with a UUID then — additive, and the slot foreign keys are straightforward.

**Open question for Donovan:** is one slot per day enough for V1? You mentioned "Monday at Bushwick spot A, Tuesday at FiDi spot B" — that's one-per-day. If someone wants "Monday morning at A, Monday evening at B" we need slot_index in the unique constraint. Default position: one-per-day in P2, multi-slot in P2.1 once a user actually asks.

### 8.4 New files

- `src/lib/cowork/favorites.ts` — `listFavorites(userId)`, `addFavorite(userId, spotId, note?)`, `removeFavorite(userId, spotId)`.
- `src/lib/cowork/plan.ts` — `getPlanForWeek(userId, isoWeek)`, `upsertSlot(userId, slot)`, `removeSlot(userId, slotId)`. `getPlanForWeek` returns a 7-element array indexed by weekday so the UI doesn't have to handle holes.
- `src/lib/cowork/iso-week.ts` — pure helpers: `currentIsoWeek(tz)`, `addWeeks(iso, n)`, `weekdayOfDate(date, tz)`. Pure functions, no Supabase deps, unit-testable.
- `src/app/me/favorites/page.tsx` — server component listing favorites with a "plan for…" popover per row.
- `src/app/plan/page.tsx` — server component renders the week grid; client islands handle popovers.
- `src/app/plan/_components/WeekGrid.tsx` — the 7-column day strip.
- `src/app/plan/_components/SlotCard.tsx` — shows one planned slot.
- `src/app/plan/_components/SaveToPlanPopover.tsx` — the "save to Tuesday" sheet used from SpotCard, /spot/[id], and /labs.
- `src/app/api/cowork/favorites/route.ts` — POST adds, DELETE removes. Validates session.
- `src/app/api/cowork/plan/route.ts` — POST upserts a slot, DELETE removes.
- `src/types/plan.ts` — `Favorite`, `PlanSlot`, `WeekPlan`.

### 8.5 Existing files that change

| File | Change | Risk |
|---|---|---|
| `src/components/SpotCard.tsx` | Add a flag-gated `<FavoriteButton spotId={spot.id} />` in the card header. Signed-out users see the button but clicking opens `/login?next=…`. | Medium — touches the highest-traffic component. Visual A/B on preview before merge. |
| `src/app/spot/[id]/page.tsx` | Add a flag-gated "Save to plan" action below the title. | Low — additive. |
| `src/components/labs/RecommendationCard.tsx` | Add a flag-gated "Add to plan" link on each pick. | Low — `/labs` is admin-gated, so blast radius is just you. |
| `src/components/Nav.tsx` (or wherever the top nav lives — `Nav.tsx` is in `components/` but `page.tsx` hardcodes its own bar; resolve in C-7) | Add "Plan" and "Favorites" links to the auth nav for signed-in users. | Medium. |
| `src/lib/labs/recommender.ts` / response shape | NO CHANGE. The plan layer reads spot IDs from the existing recommendation payload. | None. |

### 8.6 P2 ticket breakdown

#### C-9 feat(db): favorites + plan_slots tables
- **Branch:** `feat/cowork-plan-tables`
- **What:** Migration in §8.3. Apply via MCP. **No UI** in this PR.
- **Acceptance:** Tables exist; RLS verified with a two-account smoke test (user A cannot SELECT user B's favorites or slots).
- **Risk:** Additive — revertable by dropping both tables.

#### C-10 feat(cowork): favorites data layer + API
- **Branch:** `feat/cowork-favorites-api`
- **What:** `src/lib/cowork/favorites.ts` + `src/app/api/cowork/favorites/route.ts`. Idempotent POST (no error on re-favoriting). DELETE returns 204 on no-op too.
- **Acceptance:** Curl test: `POST /api/cowork/favorites { spotId }` returns 200 and a `Set-Cookie` reaffirming the session; `GET` returns the list; `DELETE` removes.
- **Risk:** Low.

#### C-11 feat(cowork): FavoriteButton component + integrate into SpotCard
- **Branch:** `feat/cowork-favorite-button`
- **What:** Optimistic-update client component. Signed-out users hitting the button get redirected to `/login?next=<current_url>`. Flag-gated.
- **Acceptance:**
  - Flag-off: SpotCard renders exactly today (no button visible).
  - Flag-on, signed-in: heart toggles instantly; refresh confirms persistence.
  - Flag-on, signed-out: click → `/login?next=…` → after sign-in, the favorite is *not* auto-applied (no "intent storage"; that's a polish ticket).
- **Risk:** Medium — highest-traffic component change of the project. Verify on preview, mobile + desktop, before merge.

#### C-12 feat(cowork): /me/favorites page
- **Branch:** `feat/cowork-me-favorites`
- **What:** Server-rendered list of favorited cafés, each with a "plan for…" link that opens `SaveToPlanPopover`.
- **Acceptance:** A user with N favorites sees N rows ordered newest-first.
- **Risk:** Low.

#### C-13 feat(cowork): iso-week utils + plan data layer
- **Branch:** `feat/cowork-plan-data`
- **What:** `iso-week.ts` (with vitest tests if you've added vitest by then, otherwise smoke-tested in the API), `plan.ts`, `src/app/api/cowork/plan/route.ts`.
- **Acceptance:** Upserting a slot for (user, '2026-W22', 1, spot_id) creates a row; upserting again for the same (user, week, weekday) updates instead of duplicating (UNIQUE constraint).
- **Risk:** Low — backend only.

#### C-14 feat(cowork): /plan page (week view + slot CRUD)
- **Branch:** `feat/cowork-plan-page`
- **What:** Server-rendered week grid + client components for save/remove popovers. Prev/next week navigation. "This week" reset.
- **Acceptance:** A signed-in user can add a slot for Tuesday, navigate to next week, see it empty, navigate back, see Tuesday filled.
- **Risk:** Medium — most net-new UI surface in the project. Allocate two days, not one.

#### C-15 feat(cowork): SaveToPlanPopover wired into SpotCard, /spot/[id], /labs RecommendationCard
- **Branch:** `feat/cowork-save-to-plan-everywhere`
- **What:** One popover component, three integration sites.
- **Acceptance:** Saving from any of the three surfaces lands the slot on `/plan` instantly.
- **Risk:** Medium — three integration points. Test on preview after each.

#### C-16 feat(nav): Plan + Favorites links in AuthNav for signed-in users
- **Branch:** `feat/cowork-plan-nav`
- **What:** Extend `AuthNav` from C-7.
- **Acceptance:** Signed-in users see "Plan · Favorites" in the nav; signed-out don't.
- **Risk:** Low.

#### C-17 docs: SHIP_LOG + ADR for plan modeling decision
- **Branch:** `docs/cowork-p2-shiplog`
- **What:** SHIP_LOG entry. New ADR: "ADR-COWORK-0003 — plan is (user, iso_week) implicit, not a parent record."
- **Risk:** None.

### 8.7 P2 risks & open questions

| Risk / question | Owner decision | Default |
|---|---|---|
| Timezone semantics — which TZ defines "Tuesday"? | Donovan | The user's profile.timezone (P1 stored). Fall back to UTC if null. Document in ADR-COWORK-0003. |
| iso_week storage as TEXT vs. computed each query | Engineering | TEXT — easier to index, easier to debug in SQL, no expression-index gymnastics |
| One slot/day vs. multi-slot | Donovan | One/day in P2; multi in P2.1 |
| Drag-drop vs. click-to-pick | UX call | Click-to-pick in P2 (accessibility wins, mobile-first); drag-drop as a P2.1 enhancement |
| Should we let the user plan a café they haven't favorited? | Donovan | Yes — the "save to plan" popover on a SpotCard implicitly creates the slot without requiring a prior favorite. Otherwise the loop has a useless friction step. |
| Favorites limit per user | Engineering | Soft limit none; surface a "you have a lot here" hint at 100+ |
| What happens to a planned slot if the underlying `spots.id` is later set to `status='rejected'` or deleted? | Engineering | `ON DELETE CASCADE` already handles deletion. For status changes, the `/plan` page filters to `status='approved'` when joining; if a slot's spot is no longer approved, show "this café was removed — remove from plan?" |
| Optimistic update conflict with rate-limited inserts | Engineering | Use Supabase's `onConflict('user_id,spot_id') do nothing` for favorites; for plan slots use upsert on the unique key |

### 8.8 P2 Definition of Done

- [ ] Flag-off: home, `/spot/[id]`, `/labs` render exactly today.
- [ ] Flag-on signed-in: favoriting a café shows up on `/me/favorites` within one round-trip.
- [ ] Flag-on signed-in: saving a café to Tuesday of the current week shows up on `/plan` immediately.
- [ ] Plan persists across logout/login.
- [ ] `/api/health` 200 after migration.
- [ ] RLS verified: a second test user cannot SELECT my favorites or slots.
- [ ] `DECISION_LOG.md` has ADR-COWORK-0003.
- [ ] `v0.4.0-cowork-plan` tagged + SHIP_LOG entry.

---

## 9. Phase 3 — Invite a friend to cowork (P3)

### 9.1 Scope (what's IN)

- **From any planned slot on `/plan`,** an "Invite a friend" action that creates an invitation row and returns a shareable URL like `cafelist.app/invite/<token>`.
- **`/invite/<token>` page** (public, no auth required to view) shows the inviter's display name, the café, the day (and time if set). Has an "I'm in" button.
- **RSVP flow:**
  - If the recipient is signed in, "I'm in" attaches their `user_id` to the invitation and the plan slot becomes mutually visible.
  - If signed out, "I'm in" routes to `/login?next=/invite/<token>` so they auth then RSVP.
- **After RSVP, both users see the other's display name** on their `/plan` view for that slot. ("With Alex →")
- **Cancel invitation** (inviter) and **withdraw RSVP** (invitee).
- **One transactional email** to the inviter when the invitee RSVPs ("Alex said they're in for Tuesday at Bushwick Spot A").
- **Invite expiry:** 14 days after creation, or after the slot's date passes, whichever is sooner.

### 9.2 Scope (what's DEFERRED)

- Multi-recipient invites — P3 is 1:1 only.
- Group plans / many-to-many.
- A "friends" social graph — invites are link-based, no friendship persisted.
- Real-time presence.
- In-app messaging.
- Email reminders the morning of the slot.
- Push notifications.
- Calendar attachment in the email.

### 9.3 DB schema changes (additive, RLS-enabled)

New migration: `supabase/migrations/20260701_cowork_invites.sql`.

```sql
-- 20260701 — Cowork Phase 3: 1:1 invites to a planned slot.

CREATE TABLE IF NOT EXISTS slot_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id         UUID NOT NULL REFERENCES plan_slots(id) ON DELETE CASCADE,
  inviter_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- null until RSVPed
  token           TEXT NOT NULL UNIQUE,                                -- url-safe random, 32 chars
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','withdrawn','expired','cancelled')),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_slot_invites_slot ON slot_invites(slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_invites_inviter ON slot_invites(inviter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slot_invites_invitee ON slot_invites(invitee_id) WHERE invitee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slot_invites_token ON slot_invites(token);

ALTER TABLE slot_invites ENABLE ROW LEVEL SECURITY;

-- Inviter reads their own invites; invitee reads invites they've
-- accepted; anyone with the token can read via the API (the API
-- enforces token-based access; RLS just gives signed-in users a
-- shortcut to their own data without round-tripping the token).
CREATE POLICY "slot_invites_party_read" ON slot_invites
  FOR SELECT USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);
CREATE POLICY "slot_invites_inviter_insert" ON slot_invites
  FOR INSERT WITH CHECK (auth.uid() = inviter_id);
CREATE POLICY "slot_invites_inviter_update" ON slot_invites
  FOR UPDATE USING (auth.uid() = inviter_id)
  WITH CHECK (auth.uid() = inviter_id);
-- Invitee can update only status->'accepted' and set invitee_id to self.
-- Enforced in the API route (RLS can't easily diff old/new on UPDATE);
-- a tighter check would use a SECURITY DEFINER function.

-- Read-via-token uses a SECURITY DEFINER function so the public invite
-- page can resolve a token without exposing the row to anon SELECT.
CREATE OR REPLACE FUNCTION get_invite_by_token(t TEXT)
RETURNS TABLE (
  invite_id UUID,
  slot_id UUID,
  inviter_display_name TEXT,
  spot_id UUID,
  iso_week TEXT,
  weekday SMALLINT,
  start_time TIME,
  end_time TIME,
  status TEXT,
  expires_at TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT si.id, ps.id, p.display_name, ps.spot_id, ps.iso_week,
         ps.weekday, ps.start_time, ps.end_time, si.status, si.expires_at
    FROM slot_invites si
    JOIN plan_slots ps ON ps.id = si.slot_id
    JOIN profiles p ON p.id = si.inviter_id
   WHERE si.token = t
     AND si.status IN ('pending','accepted')
     AND si.expires_at > NOW();
$$;

-- Also need plan_slots.show_to_invitee — for the invitee to SELECT
-- their counterpart's slot. Add via a separate function rather than
-- broadening plan_slots' RLS:
CREATE OR REPLACE FUNCTION get_invited_slots_for(uid UUID)
RETURNS SETOF plan_slots LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT ps.*
    FROM plan_slots ps
    JOIN slot_invites si ON si.slot_id = ps.id
   WHERE si.invitee_id = uid
     AND si.status = 'accepted';
$$;
```

**Open question for Donovan:** the `SECURITY DEFINER` functions are powerful and have to be reviewed carefully. Alternative: a regular API route does the JOIN with the service-role client. Tradeoff is leaking-vs-broadening — service-role-in-API is more conventional but means any bug in the route bypasses RLS. The SECURITY DEFINER pattern is tighter but harder to review. Default position: SECURITY DEFINER for the read paths because they're well-scoped (one query, no writes).

### 9.4 New files

- `src/lib/cowork/invites.ts` — `createInvite(slotId, inviterId)`, `getInviteByToken(token)`, `acceptInvite(token, userId)`, `cancelInvite(inviteId, inviterId)`, `withdrawRsvp(inviteId, userId)`.
- `src/lib/cowork/tokens.ts` — `generateInviteToken()` (32-char url-safe random via `crypto.randomBytes`).
- `src/lib/cowork/email.ts` — thin wrapper around Resend's send API. One template function per email kind (`sendRsvpNotification`).
- `src/app/invite/[token]/page.tsx` — public page (NOT in middleware matcher).
- `src/app/invite/[token]/actions.ts` — Server Action for "I'm in" / "Can't make it."
- `src/app/api/cowork/invites/route.ts` — POST create, DELETE cancel.
- `src/app/api/cowork/invites/[id]/rsvp/route.ts` — POST accept / withdraw.
- `src/app/plan/_components/InviteAFriendButton.tsx`.
- `src/app/plan/_components/InvitedWithBadge.tsx`.

### 9.5 Existing files that change

| File | Change | Risk |
|---|---|---|
| `src/app/plan/page.tsx` | Each slot card gains: "Invite a friend" (if no invite yet), "Invite link copied" (if pending), "With {invitee} ✓" (if accepted). Show invites where I am invitee too — via `get_invited_slots_for()`. | Medium — touches the highest-value UI of P2 |
| `src/middleware.ts` | NO CHANGE. `/invite/[token]` is intentionally public. Verify the matcher doesn't catch it (it doesn't — current matcher is opt-in). | Low — verify only |
| `src/lib/cowork/email.ts` (new file, but) | First email-sending code in the project. Requires `RESEND_API_KEY` env var (added in C-3). Adds an integration concern: Resend rate limits. | Medium |
| `src/app/login/page.tsx` | Add a `?next=/invite/<token>` hint in the "we sent you the link" copy so a freshly-RSVPing user knows what to expect. | Low |

### 9.6 P3 ticket breakdown

#### C-18 feat(db): slot_invites table + SECURITY DEFINER read functions
- **Branch:** `feat/cowork-invites-table`
- **What:** Migration in §9.3.
- **Acceptance:** Two-account smoke test: inviter creates invite; invitee resolves via token; RLS prevents a third user from SELECTing.
- **Risk:** Medium — first SECURITY DEFINER functions in the codebase. ADR-COWORK-0004 documents the pattern.

#### C-19 feat(cowork): invites data layer + API
- **Branch:** `feat/cowork-invites-api`
- **What:** `invites.ts`, `tokens.ts`, the two route handlers.
- **Acceptance:** Unit smoke tests in the route (curl-able): create → token returned → resolve via token → accept → invitee row populated.
- **Risk:** Medium.

#### C-20 feat(cowork): email layer (Resend wrapper) + RSVP-notification template
- **Branch:** `feat/cowork-email-resend`
- **What:** Single helper, single template, single trigger (on RSVP accept). Template is plain text + a minimal HTML version.
- **Acceptance:** Accepting an invite from account B sends one email to account A within 30 seconds.
- **Risk:** Medium — first transactional email. Failure mode: silent send failure. Wrap in try/catch, log to `console.error`, never block the RSVP response on email success.

#### C-21 feat(cowork): /invite/[token] public page
- **Branch:** `feat/cowork-invite-page`
- **What:** Renders inviter display name + spot + day + time. "I'm in" button. Signed-out flow routes through `/login?next=/invite/<token>`.
- **Acceptance:**
  - Expired/invalid token shows a friendly 404.
  - Already-accepted invite shows "you're in — see your plan."
  - Cancelled invite shows "this invite is no longer active."
- **Risk:** Low — but verify the public route does NOT trigger admin Basic Auth.

#### C-22 feat(plan): InviteAFriendButton + InvitedWithBadge on /plan
- **Branch:** `feat/cowork-plan-invites-ui`
- **What:** Slot card learns three states: no-invite, invite-pending, accepted. Invitee sees the slot on their own /plan with an "Invited by {inviter}" badge.
- **Acceptance:** End-to-end test on preview between two browser profiles.
- **Risk:** Medium.

#### C-23 docs: SHIP_LOG + ADR-COWORK-0004 SECURITY DEFINER usage
- **Branch:** `docs/cowork-p3-shiplog`
- **What:** Write up the SECURITY DEFINER choice (why over service-role-in-API). SHIP_LOG entry. Tag `v0.5.0-cowork-invites`.
- **Risk:** None.

### 9.7 P3 risks & open questions

| Risk / question | Owner decision | Default |
|---|---|---|
| Should invites be discoverable by guessing tokens? | Engineering | No — 32-char url-safe random = 192 bits of entropy. Don't shorten for the URL aesthetic. |
| Email deliverability for the RSVP notification | Operational | Resend's reputation is solid; warm the domain in P1 via login emails before P3 ships notification emails |
| Should the invitee's RSVP be revocable up to the day-of? | Donovan | Yes — `withdrawRsvp` route handles it |
| What if the inviter deletes the plan_slot after invite acceptance? | Engineering | `ON DELETE CASCADE` on slot_invites means it disappears for both. Friendly toast on invitee side: "Alex removed this slot." |
| Privacy of `profiles.display_name` shown on `/invite/<token>` | Donovan — already raised in P1 | Default position confirmed: yes, world-readable. If no, restrict to invites only via a SECURITY DEFINER. |
| Rate-limit invite creation (spam tokens) | Engineering | Add a per-user rate limit in the API route: max 20 active invites at a time |
| What if the invitee never RSVPs? | Engineering | Invite expires at 14 days; inviter sees "no response yet" state; cancel button always available |

### 9.8 P3 Definition of Done

- [ ] Inviter creates an invite link in <2 clicks from a planned slot.
- [ ] Invitee (signed-out) clicks link → signs up → lands on `/invite/<token>` → RSVPs → sees the slot on their `/plan`.
- [ ] Inviter receives a transactional email confirming the RSVP within 30 seconds.
- [ ] Two test accounts mutually see each other on the same slot.
- [ ] Expired token shows friendly 404.
- [ ] Cancelling an invite removes the link from the invitee's view immediately.
- [ ] `/api/health` 200.
- [ ] `DECISION_LOG.md` has ADR-COWORK-0004.
- [ ] `v0.5.0-cowork-invites` tagged + SHIP_LOG entry.

---

## 10. Cross-cutting concerns

### 10.1 Tests
The codebase has no test runner today (the `LABS_V2_PLAN.md` ticket #11 calls for adding vitest). Until that lands:
- API route handlers get a curl-based smoke test documented in the PR description ("Proof" section).
- Pure functions (`iso-week.ts`, `tokens.ts`) get a `npm test` once vitest is added — file the dependency on the existing labs ticket #11 and don't block on it.
- The auth flow gets a Playwright run **once** at the end of P1 (manual, document the steps in `docs/cowork/smoke-test.md`); don't automate until usage justifies it.

### 10.2 Telemetry
Mirror the `agent_query_logs` pattern. New table or column:
- Lightweight: an `events` JSON column on a single `cowork_events(user_id, type, payload, created_at)` table. Types: `signup`, `favorite_add`, `slot_save`, `invite_send`, `invite_accept`. Powers a future "/admin/ops" Cowork panel.
- Defer the table to P2 — P1 doesn't have enough events to be worth a schema.

### 10.3 Admin/ops dashboard updates
At the end of each phase, extend `/admin/ops` with a Cowork panel:
- P1: counts (total signups, active in last 7d, signups today).
- P2: counts of favorites and plan slots created.
- P3: counts of invites sent and accepted, plus an RSVP rate.

Each is a small server-rendered card — same pattern as the existing Scout/Curator/Coverage-Gap cards in `src/app/admin/ops/page.tsx`.

### 10.4 The `/me` IA — one source of truth

By end of P3 the user-internal IA looks like:
- `/me` — dashboard (this week's plan summary, recent favorites, pending invites)
- `/me/favorites`
- `/me/settings`
- `/plan` — full week view (alias linked from `/me`)
- `/invite/<token>` — public, friend-facing

Don't proliferate routes. Anything else lives under `/me/*`.

### 10.5 SEO + indexing
- `/me/*`, `/plan`, `/invite/*` all carry `robots: noindex` in metadata. They're not portfolio pages.
- The public surfaces (`/`, `/spot/*`, `/labs`) stay indexable as today.

### 10.6 Cookie policy + privacy footer
A magic-link auth flow drops a session cookie. Today the site has no cookie banner. EU/UK exposure is low (US-targeted), but adding a small "We use a session cookie when you sign in. Anonymous browsing leaves no cookie." line in the footer is the honest move. **One-line footer change, no banner, no consent gate.** Confirm with Donovan whether to add this in P1 or wait.

---

## 11. Suggested order of operations (next session)

If you sit down tomorrow:

1. **Decide on ADR-COWORK-0001** (Supabase Auth + magic-link). If undecided, that's the conversation to have first — every ticket downstream assumes it.
2. **Decide on ADR-COWORK-0002** (admin/end-user auth separation).
3. **Start C-1** (`feat/cowork-auth-bootstrap`) — boring scaffolding, ~1 hr of work, sets up the file tree and the flag.
4. **Then C-2** (migration) — apply via Supabase MCP.
5. **Then C-3** (Resend SMTP) — non-blocking operationally, do early so the email path is warm by the time C-4 ships.

After C-1–C-3 land (one PR each, all small), C-4 and C-5 are the user-visible payoff. End of week 1, you have a working sign-in flow on preview behind a flag.

---

## 12. Open questions for Donovan (lock these before P1 starts)

A small checklist, written so each can be a one-line response:

1. **Auth provider: Supabase Auth, magic-link primary?** _(default: yes — ADR-COWORK-0001)_
2. **Admin gate stays separate from end-user auth through P3?** _(default: yes — ADR-COWORK-0002)_
3. **Email provider: Resend, or do you have a preference?** _(default: Resend — free tier, easy DKIM)_
4. **`profiles.display_name` is world-readable?** _(default: yes; needed for `/invite/<token>` UX)_
5. **One plan slot per (user, day) in P2, multi-slot in P2.1?** _(default: yes — start narrow)_
6. **Timezone source: `profiles.timezone` (set during signup), with UTC fallback?** _(default: yes)_
7. **Cookie footer line in P1, or defer?** _(default: add in P1 — one line, no banner)_
8. **Username uniqueness on `display_name`?** _(default: no — it's a label, not a handle)_
9. **Drag-and-drop on `/plan`, or click-to-pick day?** _(default: click-to-pick in P2; drag in P2.1)_
10. **Should P1 wire Google OAuth at all, or strictly magic-link?** _(default: magic-link only; OAuth in P2)_

Each "default" above is what's assumed in the ticket breakdowns. Override any of them in the same response and the affected tickets get adjusted.

---

## 13. Appendix A — Current state audit (relevant slice)

Surfacing what's actually true so the plan starts from reality. Confirmed by reading the codebase 2026-05-24:

**Auth situation today.**
- `src/middleware.ts` is the only auth surface. Protects `/admin/*`, `/api/import`, `/labs`, `/api/labs/*`, and write methods on `/api/spots/*` and `/api/reviews/*`. Comment explicitly says: "Upgrade to Clerk/Supabase Auth when there's a second operator." That's the trigger; this plan is that upgrade for end-users, while leaving admin on Basic Auth (ADR-COWORK-0002).
- No `auth.users` activity yet — Supabase project exists but the auth tables are unused.
- `@supabase/ssr` is already in `package.json` (v0.10.2). No new dependency needed for P1.

**Data layer pattern.**
- `src/lib/spots.ts` is the canonical example: typed functions, `supabase` for anon-key reads, `supabaseAdmin` for service-role writes, demo-fallback when unconfigured. Cowork lib files mirror this shape.
- Migrations live in `supabase/migrations/` with date-prefix naming. Two existing examples: `20260514_add_workability_score.sql`, `20260514_scout_agent.sql`. Apply via the Supabase MCP `apply_migration` tool — same flow as labs migrations.

**Routing convention.**
- App Router with server components by default. Client components are explicit (`'use client'`) — see `src/app/labs/LabsV2Experience.tsx`.
- Each page that needs fresh data exports `export const dynamic = 'force-dynamic'` (see `src/app/page.tsx`, `src/app/admin/page.tsx`). Cowork pages with session-dependent rendering need this too.
- `/spot/[id]` is the only existing dynamic route pattern with a single param — `src/app/invite/[token]/page.tsx` follows the same pattern.

**Feature flag pattern.**
- `src/lib/labs/feature-flags.ts` is the model. Server reads `LABS_V2_ENABLED`; client reads `NEXT_PUBLIC_LABS_V2`. Mirror exactly in `src/lib/cowork/feature-flags.ts`.

**Production guardrails to respect.**
- See `LABS_V2_PLAN.md §16` rules 1–8. Every Cowork PR description repeats the rollback line. Every migration is additive. `/api/health` is the canary.

**What this plan does NOT change.**
- Existing `/`, `/spot/*`, `/submit` paths — behave identically with all flags off.
- Existing `/labs` and `/admin/*` — behave identically; flag-gating is independent.
- `getSpots`, `getSpotBySlug`, all existing reads — untouched.

---

## 14. Appendix B — How to use this doc

- **Before starting a phase,** re-read its §X.1 (scope) and §X.7 (risks).
- **Before opening a PR,** check it appears as a ticket in §X.6 with an acceptance list; if not, file the ticket here first.
- **At the end of each phase,** tag a release and write the SHIP_LOG entry. If the phase took >2 weeks, file a postmortem ticket on the doc (split the phase).
- **When a default in §12 turns out to be wrong,** edit it in the same PR as the change, mark the ADR superseded.
- **When a recruiter looks at the repo,** they should see Labs V2 → Cowork P1 → P2 → P3 as a coherent two-quarter arc, each phase tagged, each phase with a SHIP_LOG entry, each phase with one ADR explaining a real tradeoff.

If anything in this doc stops being true, update it in the same PR as the change. This doc is not the plan — it's the operating manual for the plan.
