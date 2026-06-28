# CafeList Growth OS — Agent Roles

Seven agents power the product improvement loop. Each has a defined scope, inputs, and outputs. No agent should exceed its scope — scope creep is how the system produces low-quality outputs.

The loop: **Observe → Research → Enrich → Propose → Build → QA → Release → Log → Repeat**

Agent prompts live in `/ai/prompts/`. Run outputs are saved to `/ai/runs/`.

---

## 1. Research Agent

**Purpose:** Find product, data, and SEO opportunities worth pursuing.

**When to run:** Weekly, or when triggered by a specific question ("what's the coverage situation in Fort Greene?").

**Inputs:**
- CafeList database (spots table, filtered by status=approved)
- Current app pages and routes
- Neighborhood coverage gaps (from coverage-gap agent)
- User query patterns (from agent_query_logs)
- Product principles (this repo, /ai/PRODUCT_PRINCIPLES.md)

**Outputs (one opportunity brief per run):**
- Title and type (data gap / SEO / product / QA)
- User problem being solved
- Data gaps or quality issues
- Why it matters (user impact + business rationale)
- Confidence level (high / medium / low) with reasoning
- Recommended next action

**Example output:** "Fort Greene has 13 approved spots, 0 passing the outlet + after-5pm filter. Outlet data is defaulted to false for 11 of 13. Moka & Co (workability 6.8, open until 9pm) is the strongest candidate for a late-hours page but needs outlet verification. Recommended: run enricher on Fort Greene, re-curate, re-evaluate. Do not create an SEO page yet."

**What the Research Agent does NOT do:** Write copy, make data changes, create SEO pages, or approve its own findings.

---

## 2. Data Enrichment Agent

**Purpose:** Improve underlying cafe records so the product and SEO layers have reliable data.

**When to run:** After Research identifies data gaps, before SEO or product proposals are written against the affected neighborhoods.

**Inputs:**
- Spots with `enriched_at IS NULL` or `enriched_at < NOW() - 90d`
- Existing `notes` field (review text, Google Places notes)
- `enrichment_signals` JSONB (prior enricher output if any)

**Outputs:**
- Proposed field updates (with confidence scores and source notes)
- Records needing manual verification (confidence < 0.6)
- Stale or incomplete records requiring re-verification
- Summary: how many records were updated, what fields changed, what remains uncertain

**Fields the enricher can update** (confidence ≥ threshold only):
- `has_outlets` (confidence ≥ 0.6)
- `laptop_friendly` (confidence ≥ 0.6)
- `noise_level` (confidence ≥ 0.7 to overwrite existing value)
- `vibe_tags` (additive only, never removes)
- `enrichment_signals` (full JSONB write)
- `enriched_at` (timestamp)

**Fields the enricher never touches:** hours, address, name, google_place_id, lat/lng, status, photos.

**What the Data Enrichment Agent does NOT do:** Make up data it can't source from notes. Set confidence above what evidence supports. Update `last_verified_at` — that requires a human.

**Run command:** `npm run enrich` (or `npm run enrich:dry` for preview)

---

## 3. SEO Page Agent

**Purpose:** Generate useful programmatic SEO page proposals from structured data that passes the quality bar.

**When to run:** After Research identifies a viable SEO opportunity AND after the enricher has run on the target neighborhood.

**Inputs:**
- Approved spots for the target neighborhood (filtered, scored)
- SEO rules (this repo, /ai/SEO_RULES.md)
- Quality bar (this repo, /ai/QUALITY_BAR.md)

**Quality gate (hard — non-negotiable):**
- Minimum 3 approved spots with workability ≥ 6 that match the page's claimed attributes
- All featured spots must have `last_verified_at` within 180 days OR a manual review note
- No spot can be featured if its key claimed attribute (e.g., "has outlets") comes from an unenriched default

**Output per proposal:**
- Status: READY / ON HOLD / BLOCKED (with reason)
- Target query and search intent
- Recommended slug
- H1, meta title, meta description
- Ranked spot list (max 5) with: name, workability score, why it fits, confidence labels, tradeoffs
- Data quality score (0–10)
- Indexability recommendation: index / noindex / draft-only
- Internal links
- Last updated date
- What would need to change to unblock it (if ON HOLD or BLOCKED)

**What the SEO Agent does NOT do:** Create pages for fewer than 3 qualifying spots. Claim attributes that aren't in the DB. Write generic neighborhood descriptions without data backing them.

---

## 4. Product Agent

**Purpose:** Turn repeated opportunities into product improvements that serve real user needs.

**When to run:** When Research identifies a pattern that requires a product change rather than just data enrichment or an SEO page.

**Inputs:**
- Opportunity brief from Research Agent
- User query patterns (agent_query_logs)
- Current app routes and components
- Product principles

**Output per proposal:**
- User problem (1–2 sentences, grounded in specific data)
- Proposed feature or improvement
- User story: "As a [user], I want [feature] so that [outcome]"
- Acceptance criteria (testable, specific)
- Edge cases and how to handle them
- Effort estimate (S/M/L)
- Implementation priority rationale
- Risk level (low / medium / high) with reasoning

**What the Product Agent does NOT do:** Spec features with no user demand signal. Propose UI changes without referencing actual user problems. Generate random "while I'm here" additions.

---

## 5. Engineering Agent

**Purpose:** Turn approved product specs into implementation plans safe enough to execute.

**When to run:** After a Product proposal is approved by Donovan.

**Inputs:**
- Approved product brief
- Current codebase structure (read relevant files before writing the plan)
- Production safety rules (/ai/PRODUCTION_SAFETY embedded in QUALITY_BAR.md)

**Output:**
- Files to create or modify (with specific paths)
- Schema changes (additive only — flag any destructive changes explicitly)
- Components to update
- Tests needed
- Rollback plan (env-flag flip / git revert / migration rollback)
- Risk level: LOW (additive, flag-gated) / MEDIUM (touches live routes) / HIGH (schema changes, auth, data pipeline)
- Recommendation: safe for automated implementation / requires human review step

**Non-negotiable rules:**
- All user-visible V2 changes behind `NEXT_PUBLIC_LABS_V2` flag
- All changes on `feat/*` branch, not directly to main
- Every PR has a rollback line
- No database column drops or renames without a separate migration PR and 48-hour gap

---

## 6. QA Agent

**Purpose:** Block bad changes before they go public.

**When to run:** After Engineering produces an implementation, before Donovan approves the PR.

**Checks:**
- Does the implementation match the approved spec?
- Does it break any existing flows (homepage, /labs, /admin/ops)?
- Are data claims in copy supported by actual DB values?
- Are low-confidence claims labeled as such?
- Are SEO pages thin, duplicative, or unsupported by data?
- Are routes and metadata correct?
- Are there broken links?
- Should the page be public, draft, or noindex?
- Is the rollback plan present and valid?

**Output:**
- PASS / FAIL / CONDITIONAL PASS (with required changes before merge)
- Specific issue list (each with: what's wrong, where it is, what the fix is)
- Confidence level in the QA assessment

**What the QA Agent does NOT do:** Approve its own work. Approve work it wasn't given to review. Lower standards because shipping feels urgent.

---

## 7. Release Agent

**Purpose:** Turn approved and shipped changes into visible momentum.

**When to run:** After a PR is merged and deployed to production.

**Inputs:**
- What shipped (from the PR description and CHANGELOG entry)
- What opportunity it addressed (from the run JSON)
- Before/after metrics if available

**Outputs:**
- SHIP_LOG.md entry (following the existing format)
- CHANGELOG.md update
- Portfolio update copy (1 paragraph, factual, no hype)
- LinkedIn post draft (optional, conversational, honest about what it took)
- Loom/demo script outline (optional)
- Summary of before/after improvement

**What the Release Agent does NOT do:** Overstate what shipped. Claim user impact without data. Write copy that contradicts the product principles (no "AI-powered" without explaining what that means).
