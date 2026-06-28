# Do Not Do

Things the Growth OS must never do. This list grows from hard-won experience — each entry has a reason.

---

## Data

**Do not assert "no outlets" from `has_outlets=false` alone.** The field defaults to false on Scout import. 90%+ of spots have this as a default, not a measurement. If `enriched_at` is null, the correct label is "outlet status unknown."

**Do not use `work_score` as the primary workability signal.** It aggregates user reviews that over-rate food venues. Bars average work_score 6 with workability_score 1.67. Use `workability_score`.

**Do not call a spot "verified" if `last_verified_at` is null.** It means no human has manually confirmed the data. Scout-imported spots start unverified.

**Do not treat `vibe_tags` as structured data.** They're additive and additive-only — they don't get removed when they become wrong. Cross-reference with structured fields before relying on them.

**Do not claim hours from a vibe_tag.** "24hr" in vibe_tags is not the same as structured `hours` data. Le Café Coffee in Fort Greene has "24hr" in vibe_tags but `hours=null`. That's an anomaly to flag, not a claim to surface.

---

## SEO

**Do not create public SEO pages with fewer than 3 qualifying spots.** Ever. Not "this one is almost good enough." Block it.

**Do not write neighborhood descriptions without sourced facts.** "Fort Greene's thriving coffee culture" is AI slop if we haven't verified it. The data IS the content.

**Do not create near-duplicate pages.** Two pages about Fort Greene work cafes targeting the same 3 spots hurts more than helps. Consolidate.

**Do not go live noindex-as-draft then forget to flip it.** If you create a draft page, create a ticket to either publish it or delete it within 30 days.

---

## Product

**Do not propose features with no demand signal.** "It would be cool if..." is not a user story. Every proposal needs at least one data point: a query log pattern, a user request, a specific DB gap count.

**Do not add filters for attributes we can't reliably query.** A "has outlets" filter sounds useful but would mislead users if the data is unreliable. Don't expose it until the enricher has run on ≥ 80% of approved spots.

**Do not build the same thing twice.** The existing `/admin/ops` page covers agent health. The Growth OS dashboard (`/admin/growth-os`) covers the improvement loop. They are complementary. Do not build a third ops view.

---

## Agents

**Do not run agents against production data without a dry-run first.** Every script supports `--dry-run`. Use it.

**Do not skip human approval.** The system is semi-autonomous. "Human approval" is not a rubber stamp — it's the point where Donovan reviews the agent's reasoning before anything goes public.

**Do not run Scout and the Cowork dispatcher simultaneously.** They'll pick the same priority city and waste the per-run budget on dedup no-ops. Choose one.

**Do not modify `vercel.json` crons without knowing the current state.** As of 2026-05-25, Scout's Vercel Cron is paused (`"crons": []`). Check the note in that file before restoring.

---

## Engineering

**Do not push directly to main.** Branch protection requires a PR. This applies even to "quick fixes." Especially to quick fixes.

**Do not add Notion, Airtable, or Linear.** ADR-0003 explicitly rejected these. GitHub Projects + `/admin/ops` is the project management layer.

**Do not add a second scheduling system.** Vercel Cron is the primary. Cowork scheduled tasks are the backup. Don't add a third.

**Do not drop or rename database columns without a 48-hour gap** between the migration PR and the feature PR. Simultaneous drops + feature changes are hard to roll back.

---

## Release

**Do not overstate what shipped.** "We added a filter" is accurate. "AI-powered recommendations" needs explanation. "Fully automated product improvement" is false — the system requires human approval.

**Do not publish a ship log entry for something that hasn't deployed.** "Shipped" means live on cafelist.app, not "merged to main."
