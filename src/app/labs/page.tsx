import { LabsExperience } from './LabsExperience'
import { LabsV2Experience } from './LabsV2Experience'
import { isLabsV2Enabled } from '@/lib/labs/feature-flags'

export const metadata = {
  title: 'Labs — Cafelist',
  description:
    'Experimental agentic discovery layer. Describe what you need in plain English; the agent parses, retrieves, scores, recommends, and evaluates — with a full observable trace.',
}

// Static shell wraps the client experience so the page itself can be
// statically rendered and only the interactive part hydrates.
//
// V2 mode picker is gated by isLabsV2Enabled() — the check runs on
// the server (this is a server component) so flag-off prod never
// even ships the V2 client bundle. Per DECISION_LOG.md ADR-0004,
// the existing free-text /labs is the default until V2 is end-to-end
// ready and we flip the Vercel env var.
export default function LabsPage() {
  const v2 = isLabsV2Enabled()

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      {v2 ? <LabsV2Experience /> : <LabsExperience />}
    </div>
  )
}
