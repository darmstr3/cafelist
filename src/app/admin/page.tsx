import { adminGetAllSpots, adminGetAllReviews } from '@/lib/spots'
import { AdminDashboard } from '@/components/AdminDashboard'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const [spots, reviews] = await Promise.all([
    adminGetAllSpots().catch(() => []),
    adminGetAllReviews().catch(() => []),
  ])

  return <AdminDashboard initialSpots={spots} initialReviews={reviews} />
}
