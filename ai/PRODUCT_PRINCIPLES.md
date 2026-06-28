# CafeList Product Principles

These are the rules every agent must respect. They take precedence over optimism, over SEO potential, and over the desire to ship. Agents that violate these principles produce outputs that should be rejected by QA without exception.

---

## On data honesty

**Workability beats popularity.** A 4.8-star Google rating is irrelevant to whether someone can sit there for two hours with a laptop. Do not use review score as a proxy for workability.

**A highly rated cafe can still be bad for working.** Bars, brunch spots, and food-first restaurants frequently score well on Google and poorly on workability. The Curator agent's separation of `workability_score` from `work_score` exists for exactly this reason.

**Do not present weak signals as facts.** If a field is null, say so. If it was inferred, say so and give the confidence level. If it was default-filled, say so. The words "confirmed," "verified," and "we found" are reserved for data with direct source attribution.

**Manual verification outranks scraped assumptions.** A human-verified field is worth more than 10 aggregated reviews. `last_verified_at` is the most trustworthy signal in the schema. If it's null, treat the data with appropriate skepticism.

**Stale data should be labeled, refreshed, or excluded.** Data older than 90 days should be flagged. The enricher and curator both use 90-day staleness gates. SEO pages should display the "last reviewed" date and go noindex if their underlying data is stale.

**Outlet data is chronically unreliable.** The `has_outlets` field defaults to false and was not reliably populated during Scout imports. 90%+ of spots imported before the enricher was built have `has_outlets=false` as a default, not a measurement. Never assert "no outlets" from this field alone. Check `enriched_at` and `enrichment_signals` first. If `enriched_at` is null, the outlet status is unknown, not false.

---

## On recommendations

**Every recommendation should explain tradeoffs.** A spot with great quiet but no outlets needs to say so. A spot that closes at 5pm for a "remote work" query needs to flag that conflict. The workability_reasoning field is the model for this.

**Data confidence matters.** Surface it explicitly. "Confirmed wifi" is different from "likely wifi." "Closes at 9pm" (from structured hours) is different from "reportedly open late" (from a review mention).

**Do not invent facts the LLM cannot verify from retrieved fields.** The recommender prompt enforces this. The Growth OS agents must enforce the same rule. If a field isn't in the DB, don't claim it.

---

## On SEO pages

**SEO pages should only be created when they are useful and backed by real structured data.** A page with 0 spots that meet the quality bar should not exist publicly. A page with 1 spot is borderline — only create it if the single spot is very strong and the query is very specific.

**Thin or unsupported pages are worse than no page.** They create false authority, disappoint users, and damage trust. The quality gate in SEO_RULES.md is not optional.

**Avoid AI slop.** No "ultimate guide" framing. No invented prose about a neighborhood. No "expert picks" without sourcing the expertise. Write like a knowledgeable local who checked the facts, not like an AI generating SEO content.

---

## On the system itself

**Build for practical user decisions, not generic content.** Someone choosing a cafe at 6pm on a Tuesday needs accurate hours and outlet status, not a 500-word intro paragraph about Fort Greene's "thriving coffee culture."

**Keep the system simple enough that Donovan will actually maintain it.** Complexity that requires a dedicated ops engineer is the wrong complexity. Every agent should be runnable with a single `npm run` command or a clear manual process.

**Human approval is not a formality.** The Growth OS is semi-autonomous, not fully autonomous. The loop always includes a human checkpoint before anything goes public. Do not design outputs that assume approval is automatic.

**The case study is the work itself.** The system's value is demonstrated by the quality of what it produces and blocks, not by how autonomous it appears. A well-reasoned "don't ship this yet" is as valuable as a ship.
