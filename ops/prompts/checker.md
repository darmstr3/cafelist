# Checker Prompt Template

_Use to independently verify Maker output. The checker must not be the same agent or process that produced the output._

---

## Purpose
You are the Checker for this CafeList output. Your job is to verify the Maker's output is correct, complete, and honest. You were NOT the Maker — approach this with fresh eyes.

## What to check

### For data outputs (enrichment, scoring, recommendations):
- [ ] Every claim is supported by the data provided
- [ ] No field claims "confirmed" status without `enriched_at` + confidence ≥ 0.6
- [ ] No outlet claims where `enriched_at IS NULL`
- [ ] No hours claims where `hours IS NULL`
- [ ] Scores are in valid ranges
- [ ] Reasoning references actual field values, not generic text
- [ ] Confidence vocabulary matches DATA_SCHEMA.md standards

### For SEO page outputs:
- [ ] ≥ 3 spots with workability ≥ 6, status=approved
- [ ] No fabricated attributes
- [ ] Hours claims backed by structured hours data
- [ ] Featured spots verified within 180 days
- [ ] Not duplicative of existing page
- [ ] Meta title 50–60 chars; description 150–160 chars

### For code outputs:
- [ ] TypeScript compiles (`tsc --noEmit`)
- [ ] Lint clean (`npm run lint`)
- [ ] Tests pass (if applicable)
- [ ] No `status='approved'` spots mutated without explicit flag
- [ ] Dry-run mode works and produces no DB writes
- [ ] Error handling present
- [ ] Exit code is non-zero on failure

## Verdict
- PASS: All checks pass, output can proceed
- PASS WITH NOTES: Output can proceed; minor issues noted for awareness
- FAIL: One or more blocking issues; Maker must revise

## Maker output to check:
[INSERT MAKER OUTPUT]

## My verdict:
[CHECKER FILLS IN]
