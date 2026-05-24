// ─────────────────────────────────────────────────────────────
// scripts/labs-eval.ts
//
// Offline evaluation harness for the deterministic core of the
// /labs agent pipeline. Bypasses Claude entirely by hand-crafting
// `ParsedIntent` objects that mirror what the intent parser would
// realistically produce, then runs the real retriever and fit
// scorer against them. The goal is to verify the parts of the
// system that should be predictable BEFORE we worry about LLM
// outputs.
//
// Run:  npx tsx scripts/labs-eval.ts
// ─────────────────────────────────────────────────────────────

import { scoreCandidates } from '../src/lib/labs/fit-scorer'
import { retrieveCafes } from '../src/lib/labs/retriever'
import type { ParsedIntent } from '../src/lib/labs/types'

const CASES: Array<{ name: string; query: string; intent: ParsedIntent }> = [
  {
    name: 'Manhattan / after 6pm / quiet / outlets / F train',
    query:
      'I need somewhere in Manhattan to work for 3 hours after 6pm, not too loud, outlets preferred, near the F train.',
    intent: {
      rawQuery: '...',
      city: 'New York City',
      neighborhood: 'Manhattan',
      transit: ['F train'],
      timeOfDay: 'after 6pm',
      startTimeIso: null,
      durationMinutes: 180,
      weekday: null,
      noiseTolerance: 'quiet',
      vibe: [],
      needsOutlets: true,
      needsWifi: null,
      laptopFriendly: true,
      needsFood: null,
      avoid: [],
      preferredTypes: [],
      priorities: {
        neighborhood: 'must',
        timeOfDay: 'must',
        noiseTolerance: 'should',
        needsOutlets: 'should',
        laptopFriendly: 'should',
      },
    },
  },
  {
    name: 'Brooklyn / past midnight / wifi must / no chains',
    query: 'A quiet coffee shop in Brooklyn open past midnight, must have wifi, no chains.',
    intent: {
      rawQuery: '...',
      city: 'New York City',
      neighborhood: 'Brooklyn',
      transit: [],
      timeOfDay: 'past midnight',
      startTimeIso: null,
      durationMinutes: null,
      weekday: null,
      noiseTolerance: 'quiet',
      vibe: [],
      needsOutlets: null,
      needsWifi: true,
      laptopFriendly: null,
      needsFood: null,
      avoid: ['chains'],
      preferredTypes: ['coffee_shop'],
      priorities: {
        neighborhood: 'must',
        timeOfDay: 'must',
        needsWifi: 'must',
        noiseTolerance: 'should',
      },
    },
  },
  {
    name: 'Late-night Austin / vibe-y / wifi solid / loud ok',
    query:
      'Late-night spot in Austin to write, vibe-y, ok if a bit loud as long as wifi is solid.',
    intent: {
      rawQuery: '...',
      city: 'Austin',
      neighborhood: null,
      transit: [],
      timeOfDay: 'late-night',
      startTimeIso: null,
      durationMinutes: null,
      weekday: null,
      noiseTolerance: 'moderate',
      vibe: ['vibe-y'],
      needsOutlets: null,
      needsWifi: true,
      laptopFriendly: true,
      needsFood: null,
      avoid: [],
      preferredTypes: [],
      priorities: {
        timeOfDay: 'must',
        needsWifi: 'must',
        laptopFriendly: 'should',
        vibe: 'should',
      },
    },
  },
]

async function main() {
  for (const c of CASES) {
    console.log('\n' + '═'.repeat(72))
    console.log(`CASE: ${c.name}`)
    console.log(`QUERY: ${c.query}`)
    console.log('─'.repeat(72))

    const retrieval = await retrieveCafes(c.intent)
    console.log(`Retrieval: source=${retrieval.source} searched=${retrieval.totalSearched} kept=${retrieval.candidates.length}`)
    console.log(`Filters:   ${retrieval.filtersApplied.join(' · ') || '(none)'}`)

    const scored = scoreCandidates(c.intent, retrieval.candidates)
    console.log('\nTop 6 by fit score:')
    console.log(
      'Rank  Fit  Conf  Spot                              City/Neighborhood              L/T/N/F/V'
    )
    scored.slice(0, 6).forEach((s, i) => {
      const cand = retrieval.candidates.find((cd) => cd.id === s.spotId)
      const loc = `${cand?.neighborhood ?? cand?.city ?? '?'}`.padEnd(28).slice(0, 28)
      const name = s.spotName.padEnd(32).slice(0, 32)
      const cs = s.componentScores
      console.log(
        `${String(i + 1).padStart(3)}.  ${String(s.fitScore).padStart(3)}  ${String(Math.round(s.confidence * 100)).padStart(3)}%  ${name}  ${loc}  ${cs.location}/${cs.time}/${cs.noise}/${cs.features}/${cs.vibe}`
      )
    })
    const top = scored[0]
    if (top) {
      console.log(`\nTop pick: ${top.spotName}`)
      if (top.reasons.length) console.log('  + ' + top.reasons.join(' · '))
      if (top.tradeoffs.length) console.log('  ~ ' + top.tradeoffs.join(' · '))
      if (top.missingData.length) console.log('  ? ' + top.missingData.join(' · '))
    }
  }
  console.log('\n' + '═'.repeat(72))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
