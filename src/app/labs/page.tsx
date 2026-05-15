import { LabsExperience } from './LabsExperience'

export const metadata = {
  title: 'Labs — Cafelist',
  description:
    'Experimental agentic discovery layer. Describe what you need in plain English; the agent parses, retrieves, scores, recommends, and evaluates — with a full observable trace.',
}

// Static shell wraps the client experience so the page itself can be
// statically rendered and only the interactive part hydrates.
export default function LabsPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <LabsExperience />
    </div>
  )
}
