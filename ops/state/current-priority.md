# Current Priority

_Updated every Friday. Max 3 priorities at a time. If more than 3 things are urgent, the list is wrong._

**Last updated:** 2026-06-13

---

## This week's top priorities

### 1. Verify query logging pipeline
The `agent_query_logs` table has had zero writes since 2026-05-25 (OPS-0005 in docs/DECISION_LOG.md). Coverage gap analysis is running blind. Fix or confirm there's no traffic before any other data work.

**Why it matters:** Scout prioritization is based on demand signals. Without logs, Scout runs on hardcoded seeds.

**Done when:** A test query to `/api/labs/recommend` produces a row in `agent_query_logs` within 30 seconds.

---

### 2. Run enrichment on pending spots
Several imported spots have `enriched_at IS NULL`. Run `npm run enrich` to populate enrichment signals before the next Curator pass. This unblocks Fort Greene expansion.

**Why it matters:** Curator scores improve significantly with richer inputs. Outlet claims can't be made without enrichment.

**Done when:** `npm run cafelist:check-stale` shows < 20 spots with `needs_enrichment` status.

---

### 3. Review quality gate output and manual-review queue
`npm run cafelist:quality-gate` is newly implemented. Run it once to establish the baseline quality distribution across all approved spots. Review `ops/queues/manual-review.json` for flagged items.

**Why it matters:** Establishes the data quality baseline and surfaces the first batch of spots needing attention.

**Done when:** Quality gate report exists in `ops/reports/`, manual-review queue reviewed and triaged.

---

## Backlog (not this week)

- Labs V2 mode picker implementation (blocked on query logging fix)
- Fort Greene neighborhood expansion (blocked on enrichment pass)
- SEO page creation workflow (blocked on quality gate baseline)
- Weekly growth review cadence (start after Labs V2 ships)
