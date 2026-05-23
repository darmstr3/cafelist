import { adminGetAllSpots, adminGetAllReviews, adminGetScoutRuns } from '@/lib/spots'
import { AdminDashboard } from '@/components/AdminDashboard'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const [spots, reviews, scoutRuns] = await Promise.all([
    adminGetAllSpots().catch(() => []),
    adminGetAllReviews().catch(() => []),
    adminGetScoutRuns(50).catch(() => []),
  ])

  return (
    <AdminDashboard
      initialSpots={spots}
      initialReviews={reviews}
      initialScoutRuns={scoutRuns}
    />
  )
}
