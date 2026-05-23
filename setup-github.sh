#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# One-shot GitHub setup for Cafelist.
#
# What this does (in order):
#   1. Pre-flight checks (gh CLI, repo state, sandbox lockfile).
#   2. Configures git author identity.
#   3. Lands the 17 uncommitted files as 6 themed commits.
#   4. Tags v0.1.0-baseline.
#   5. Appends Labs V2 env-flag lines to .env.local.example.
#   6. Commits the V2 kickoff docs + CI + feature-flag scaffold.
#   7. Creates the public GitHub repo at darmstr3/cafelist.
#   8. Pushes main + tags.
#   9. Enables branch protection on main (PR + CI required).
#
# Run from the repo root:
#   bash setup-github.sh
#
# This script is idempotent at the "have we already done this?"
# level — if you re-run, it skips work that's already done and
# warns rather than failing destructively. Inspect output.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# Colors for readability
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✘${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${BLUE}━━━${NC} $* ${BLUE}━━━${NC}"; }

GITHUB_USER="darmstr3"
REPO_NAME="cafelist"
REPO_DESC="Find a café for what you're trying to do — not just what's nearby. Agentic discovery layer over a real café directory."

# ─── 1. Pre-flight ───────────────────────────────────────────
step "1/9  Pre-flight checks"

[[ -f package.json && -d .git ]] || fail "Run this from the repo root (where package.json and .git live)."

STALE_LOCKS=$(find .git -name "*.lock" 2>/dev/null || true)
if [[ -n "$STALE_LOCKS" ]]; then
  warn "Stale .git lock files found — removing:"
  echo "$STALE_LOCKS"
  find .git -name "*.lock" -delete
fi

command -v gh >/dev/null 2>&1 || fail "gh CLI not installed. Install: https://cli.github.com/  (brew install gh)"
gh auth status >/dev/null 2>&1 || fail "gh not authenticated. Run: gh auth login"

CURRENT_USER=$(gh api user --jq .login 2>/dev/null || echo "")
[[ "$CURRENT_USER" == "$GITHUB_USER" ]] || warn "gh is authed as '$CURRENT_USER' but script targets '$GITHUB_USER'. Continuing anyway."

CURRENT_BRANCH=$(git branch --show-current)
[[ "$CURRENT_BRANCH" == "main" ]] || fail "Expected branch 'main', got '$CURRENT_BRANCH'. Switch first."

ok "Pre-flight passed."

# ─── 2. Git identity ─────────────────────────────────────────
step "2/9  Git identity"

if ! git config user.name >/dev/null; then
  git config user.name "Donovan Armstrong"
  ok "Set git user.name"
fi
if ! git config user.email >/dev/null; then
  git config user.email "armstrongdonovan3@gmail.com"
  ok "Set git user.email"
fi
ok "Author: $(git config user.name) <$(git config user.email)>"

# ─── 3. Themed commits for the uncommitted baseline work ─────
step "3/9  Landing existing work as 6 themed commits"

# Detect whether we've already done this run — if v0.1.0-baseline
# tag exists, skip ahead to V2 kickoff section.
if git rev-parse -q --verify "refs/tags/v0.1.0-baseline" >/dev/null; then
  warn "Tag v0.1.0-baseline already exists — skipping themed-commit phase."
  SKIP_BASELINE=1
else
  SKIP_BASELINE=0
fi

if [[ "$SKIP_BASELINE" == "0" ]]; then

  # Verify the expected files are present and unstaged before we touch anything.
  EXPECTED_NEW=(
    "JOURNAL.md"
    "src/app/labs/eval/page.tsx"
    "src/app/labs/eval/case"
    "src/app/api/scout/route.ts"
    "vercel.json"
    "src/middleware.ts"
    "src/app/admin/ops"
    "src/lib/admin/ops-queries.ts"
  )
  for f in "${EXPECTED_NEW[@]}"; do
    [[ -e "$f" ]] || warn "Expected file/dir not found: $f (continuing — verify status below)."
  done

  # Commit 1: JOURNAL.md
  git add JOURNAL.md
  git commit -m "docs: add JOURNAL.md engineering log

Append-only build log for the agent stack (Curator, Scout, prompt
optimizer, /admin/ops, admin middleware). Newest entries on top.
Prompt optimizer prepends to this automatically on promotion."
  ok "Commit 1/6: docs(JOURNAL)"

  # Commit 2: /labs/eval dashboard
  git add src/app/labs/eval/page.tsx \
          src/app/labs/eval/case \
          src/app/labs/eval/_components/LineChart.tsx \
          scripts/eval.ts
  git commit -m "feat(labs): /labs/eval dashboard with per-case detail and regression highlighting

End-to-end eval surface for the /labs agent pipeline. Reads from
agent_eval_runs/results in Supabase. Deterministic checks run
BEFORE the LLM judge to keep cost ~\$0.05/run. Prompt-hash
versioning makes every change attributable on the dashboard.

Server-rendered. Public-read RLS, no auth needed.
Run: npm run eval"
  ok "Commit 2/6: feat(labs/eval)"

  # Commit 3: Scout agent + Vercel Cron
  git add src/app/api/scout/route.ts \
          vercel.json \
          scripts/scout.ts \
          src/components/AdminDashboard.tsx
  git commit -m "feat(agents): Scout discovery agent driven by Vercel Cron

Scout proactively fills the spots table by city. Each run picks the
highest-priority entry from scout_priority, runs three Google Places
text queries biased to the city, dedupes against google_place_id,
and inserts up to 25 new pending rows for Curator to score.

- src/app/api/scout/route.ts — HTTP entrypoint. Auth via
  SCOUT_CRON_SECRET (operator) or CRON_SECRET (Vercel). Fails closed
  in prod when secrets are missing.
- vercel.json — cron 7 */4 * * * → /api/scout.
- scripts/scout.ts — CLI wrapper (npm run scout / scout:dry).
- AdminDashboard — new \"Scout\" tab + scout-source filters/badges.

Hard cost caps: \$0.50/run, \$3.00/24h. Read from scout_runs."
  ok "Commit 3/6: feat(agents/scout)"

  # Commit 4: admin middleware + env config
  git add src/middleware.ts .env.local.example
  git commit -m "feat(admin): HTTP Basic Auth middleware + env config

Gates /admin/* and mutating /api/import, /api/spots, /api/reviews
behind ADMIN_USERNAME/ADMIN_PASSWORD. Public GETs to spot/review
detail still work. /api/scout has its own bearer-token auth.
/api/health stays intentionally public for observability.

Fails CLOSED in production — missing ADMIN_PASSWORD returns 503 on
every protected path. Silently no-ops in dev when unset.

.env.local.example documents SCOUT_CRON_SECRET (Scout agent) and
ADMIN_USERNAME/ADMIN_PASSWORD (this middleware). Both MUST be set
on Vercel for production to function."
  ok "Commit 4/6: feat(admin/middleware)"

  # Commit 5: /admin/ops dashboard
  git add src/app/admin/ops \
          src/lib/admin \
          src/app/admin/page.tsx
  git commit -m "feat(admin): /admin/ops single-page operator dashboard

Aggregates all 5 agents (Scout / Curator / Coverage-Gap / Optimizer
/ Eval) onto one page so I don't have to hunt through Cowork chats.

- src/lib/admin/ops-queries.ts — one snapshot function per agent,
  aggregated by getOpsSnapshot(). Non-throwing fallbacks per agent.
- src/app/admin/ops/page.tsx — server-rendered, 5 status cards,
  \"Run scout now\" server action, refresh button. Reuses CSS vars
  from existing labs/eval styling.
- src/app/admin/page.tsx — links to /admin/ops.

Vercel Cron is the primary trigger for Scout (replaced the broken
Cowork dispatcher). Cowork task remains as a backup."
  ok "Commit 5/6: feat(admin/ops)"

  # Commit 6: page.tsx + spots/supabase refactor
  git add src/app/page.tsx \
          src/lib/spots.ts \
          src/lib/supabase.ts
  git commit -m "chore: hide /labs link from homepage; types refactor

src/app/page.tsx
  - Remove the \"Labs\" link from the homepage nav while V2 is in
    development. /labs is reachable directly with admin credentials.

src/lib/spots.ts + src/lib/supabase.ts
  - Move isSupabaseConfigured() to supabase.ts as a shared export.
  - Add ScoutRunRow type + adminGetRecentScoutRuns helper used by
    the /admin/ops Scout panel."
  ok "Commit 6/6: chore(ui+types)"

  # ─── 4. Tag the baseline ─────────────────────────────────────
  step "4/9  Tagging v0.1.0-baseline"

  git tag -a v0.1.0-baseline -m "Labs V1 baseline.

State of cafelist before V2 work begins. /labs free-text discovery
is live in production. Five background agents (Scout, Curator,
Coverage-Gap, Prompt Optimizer, Eval Harness) shipped. /admin/ops
aggregates them. Admin Basic Auth gates write paths.

Next: Labs V2 mode picker, on feat/labs-* branches, gated behind
NEXT_PUBLIC_LABS_V2. See LABS_V2_PLAN.md."
  ok "Tagged v0.1.0-baseline"

fi  # end SKIP_BASELINE

# ─── 5. Append V2 flag to env example ────────────────────────
step "5/9  Documenting NEXT_PUBLIC_LABS_V2 in .env.local.example"

if grep -q "NEXT_PUBLIC_LABS_V2" .env.local.example; then
  ok "NEXT_PUBLIC_LABS_V2 already documented — skipping."
else
  cat >> .env.local.example <<'ENVFLAG'

# ── Labs V2 feature flag ─────────────────────────────────────
# Gates the V2 mode-picker UI and the V2 payload shape on
# /api/labs/recommend. Leave OFF in production until V2 is
# end-to-end ready; set to "on" in Vercel preview env vars so
# preview deploys show the work in progress.
#
# See src/lib/labs/feature-flags.ts and LABS_V2_PLAN.md §16.
NEXT_PUBLIC_LABS_V2=off
LABS_V2_ENABLED=off
ENVFLAG
  ok "Appended NEXT_PUBLIC_LABS_V2 / LABS_V2_ENABLED."
fi

# ─── 6. V2 kickoff commit ────────────────────────────────────
step "6/9  V2 kickoff commit (docs + CI + feature flag)"

# Only commit if there are staged-able V2 docs.
if git diff --quiet && git diff --staged --quiet && [[ -z "$(git status --porcelain)" ]]; then
  warn "Nothing to commit for V2 kickoff — already landed."
else
  git add README.md \
          CHANGELOG.md \
          SHIP_LOG.md \
          DECISION_LOG.md \
          LABS_V2_PLAN.md \
          .github/workflows/ci.yml \
          .github/PULL_REQUEST_TEMPLATE.md \
          src/lib/labs/feature-flags.ts \
          .env.local.example \
          setup-github.sh

  git commit -m "docs(v2): operating manual, portfolio docs, CI, feature flag

Kick off Labs V2.

Docs
  - LABS_V2_PLAN.md   — operating manual (mission, scope, cadence,
                         agent responsibilities, Week-1 tickets,
                         production-safety rules, templates).
  - README.md         — full rewrite for V2 framing.
  - CHANGELOG.md      — Keep-a-Changelog format.
  - SHIP_LOG.md       — weekly narrative.
  - DECISION_LOG.md   — ADR-0001..0004.

Infra
  - .github/workflows/ci.yml — lint + typecheck on PR/push.
  - .github/PULL_REQUEST_TEMPLATE.md — proof / risk / rollback.
  - src/lib/labs/feature-flags.ts — isLabsV2Enabled().
  - .env.local.example — NEXT_PUBLIC_LABS_V2 / LABS_V2_ENABLED.
  - setup-github.sh — bootstrap script (this file)."
  ok "V2 kickoff commit landed."
fi

# ─── 7. Create remote (if missing) ───────────────────────────
step "7/9  GitHub remote at github.com/$GITHUB_USER/$REPO_NAME"

if git remote get-url origin >/dev/null 2>&1; then
  EXISTING=$(git remote get-url origin)
  warn "origin already set to $EXISTING — skipping repo create."
else
  if gh repo view "$GITHUB_USER/$REPO_NAME" >/dev/null 2>&1; then
    warn "Repo already exists on GitHub — adding it as origin."
    git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
  else
    gh repo create "$GITHUB_USER/$REPO_NAME" \
      --public \
      --source=. \
      --remote=origin \
      --description="$REPO_DESC" \
      --homepage="https://cafelist.app"
    ok "Repo created and origin set."
  fi
fi

# ─── 8. Push main + tags ─────────────────────────────────────
step "8/9  Pushing main + tags"

git push -u origin main
git push origin --tags
ok "Pushed."

# ─── 9. Branch protection ────────────────────────────────────
step "9/9  Branch protection on main"

# Requires the CI workflow to have run at least once for the
# check name to register. We'll set the protection anyway and
# require the CI status check — first PR will validate it.

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/$GITHUB_USER/$REPO_NAME/branches/main/protection" \
  -f required_status_checks[strict]=true \
  -F 'required_status_checks[contexts][]=Lint + Typecheck' \
  -F required_pull_request_reviews[required_approving_review_count]=0 \
  -F required_pull_request_reviews[dismiss_stale_reviews]=true \
  -F enforce_admins=false \
  -F restrictions= 2>&1 | head -20 || warn "Branch protection call returned non-zero — check the output above. You may need to set it manually at Settings → Branches."

ok "Branch protection requested (or warned)."

# ─── Done ────────────────────────────────────────────────────
step "Done"

cat <<EOF

  ${GREEN}Setup complete.${NC}

  Next:
    1. Open: https://github.com/$GITHUB_USER/$REPO_NAME
    2. Verify branch protection at Settings → Branches.
    3. Create the v0.1.0-baseline GitHub Release from the tag:
         gh release create v0.1.0-baseline --title "Labs V1 baseline" --generate-notes
       (Or paste CHANGELOG.md's [0.1.0-baseline] section via the GitHub UI.)
    4. Set up the GitHub Project board (Settings → Projects → New).
    5. Open the first Week-1 ticket (#1 "create public GitHub remote")
       and close it — you just shipped it.
    6. Cut a feature branch for ticket #2 (CI workflow is already in,
       so this is your CI verification PR): create a trivial PR
       (README typo fix) to confirm CI runs green and branch
       protection works as expected.

  ${YELLOW}Production safety reminders:${NC}
    • main = production. Every merge auto-deploys to cafelist.app.
    • V2 work lives on feat/labs-* branches with Vercel previews.
    • NEXT_PUBLIC_LABS_V2 / LABS_V2_ENABLED stay OFF in prod env.
    • Verify cafelist.app/api/health is green after the first push
      (no V2 code is enabled yet, but worth a quick sanity check).

EOF
