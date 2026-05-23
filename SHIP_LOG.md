# Ship Log

Weekly narrative of what shipped. Newest at top. Skim-optimized.

---

## 2026-05-23 — v0.1.0-baseline — Project Lead Agent stood up; baseline tagged

**What shipped (user-visible).**
- Nothing new on cafelist.app this week. /labs V1 (free-text) remains live; V2 work has not yet started.

**What shipped (under the hood).**
- Public GitHub repo created at `github.com/darmstr3/cafelist`.
- 17 previously-uncommitted files landed as 6 themed commits so the production state is legible in git: JOURNAL, /labs/eval dashboard, Scout + Vercel Cron, admin Basic Auth + env, /admin/ops dashboard, page/types refactor.
- Tagged `v0.1.0-baseline` — the "Labs V1" snapshot.
- New: `LABS_V2_PLAN.md` (operating manual), `CHANGELOG.md`, `SHIP_LOG.md`, `DECISION_LOG.md`, `.github/workflows/ci.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `src/lib/labs/feature-flags.ts`.
- Branch protection on `main` enforced (PR + green CI required).

**Numbers.** Commits this week: 7. PRs merged: 0 (pre-PR phase). Open issues: TBD after GitHub board setup. Eval quality: not measured yet (baseline run pending).

**Surprises.** Local git working tree had 17 uncommitted files representing the entire `/admin/ops`, Scout, admin-gate, and eval-dashboard work — all of which appears to be running in production. The portfolio was on disk but not on GitHub. Landing them as themed commits is the single highest-leverage move this week.

**Next.** Week 1 of LABS_V2_PLAN.md tickets #1–#13. Highest priority: README sanity-check, branch protection verification, then mode picker scaffold behind the V2 flag.

**Links.** Tag `v0.1.0-baseline`. PR #1 (V2 kickoff docs). [LABS_V2_PLAN.md](./LABS_V2_PLAN.md).
