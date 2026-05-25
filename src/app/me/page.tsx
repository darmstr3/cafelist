/**
 * /me — current user's profile. Shows favorites, tried list, want-to-go,
 * plus stubs for the upcoming weekly plan and friends features.
 *
 * Anonymous visitors get redirected to /login with ?next=/me so they
 * land back here after signing in.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Heart, Check, Bookmark, Calendar, Users } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { Spot } from '@/types'

export const dynamic = 'force-dynamic'

interface RelationWithSpot {
  id: string
  relation_type: 'favorite' | 'tried' | 'want_to_go'
  created_at: string
  visited_at: string | null
  spots: Spot
}

export default async function MePage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/me')

  // Load profile + relations in parallel.
  const [{ data: profile }, { data: relations }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('user_spot_relations')
      .select('id, relation_type, created_at, visited_at, spots(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .returns<RelationWithSpot[]>(),
  ])

  const favs = relations?.filter((r) => r.relation_type === 'favorite') ?? []
  const tried = relations?.filter((r) => r.relation_type === 'tried') ?? []
  const wantTo = relations?.filter((r) => r.relation_type === 'want_to_go') ?? []

  const displayName = profile?.display_name ?? user.email?.split('@')[0] ?? 'You'
  const avatarUrl = profile?.avatar_url

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="wordmark text-[18px]" style={{ color: 'var(--text-primary)' }}>
              Cafelist
            </span>
          </Link>
          <Link
            href="/"
            className="ml-auto text-[11px] font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-muted)' }}
          >
            ← Back to all
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* ── Profile header ── */}
        <div className="flex items-center gap-4 mb-8">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={displayName}
              width={64}
              height={64}
              className="rounded-full"
              unoptimized
            />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold"
              style={{
                backgroundColor: 'var(--surface-2)',
                color: 'var(--text-secondary)',
              }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1
              className="text-2xl font-bold leading-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              {displayName}
            </h1>
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {user.email}
            </p>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-3 gap-2 mb-10">
          <StatCard icon={Heart} count={favs.length} label="Favorites" />
          <StatCard icon={Check} count={tried.length} label="Been to" />
          <StatCard icon={Bookmark} count={wantTo.length} label="Want to go" />
        </div>

        {/* ── Favorites ── */}
        <Section title="Favorites" icon={Heart} empty="Heart a spot to save it here.">
          {favs.length > 0 && <SpotGrid relations={favs} />}
        </Section>

        {/* ── Been there ── */}
        <Section
          title="Been there"
          icon={Check}
          empty='Tap "Been here" on a spot page to track it.'
        >
          {tried.length > 0 && <SpotGrid relations={tried} />}
        </Section>

        {/* ── Want to go ── */}
        <Section
          title="Want to go"
          icon={Bookmark}
          empty='Tap "Want to go" on a spot page to bookmark it.'
        >
          {wantTo.length > 0 && <SpotGrid relations={wantTo} />}
        </Section>

        {/* ── Weekly plan (stub) ── */}
        <Section
          title="Weekly plan"
          icon={Calendar}
          empty="Coming soon — plan a different cafe for each day of the week."
          comingSoon
        >
          {null}
        </Section>

        {/* ── Friends (stub) ── */}
        <Section
          title="Friends"
          icon={Users}
          empty="Coming soon — follow people to see their favorites and weekly plans."
          comingSoon
        >
          {null}
        </Section>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  count,
  label,
}: {
  icon: typeof Heart
  count: number
  label: string
}) {
  return (
    <div
      className="flex flex-col items-center gap-1 p-4 rounded-xl border"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
    >
      <Icon size={16} style={{ color: 'var(--text-muted)' }} />
      <span className="text-[22px] font-bold" style={{ color: 'var(--text-primary)' }}>
        {count}
      </span>
      <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  empty,
  children,
  comingSoon,
}: {
  title: string
  icon: typeof Heart
  empty: string
  children: React.ReactNode
  comingSoon?: boolean
}) {
  const hasContent = children != null && (Array.isArray(children) ? children.length > 0 : true)
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} style={{ color: 'var(--text-secondary)' }} />
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
        {comingSoon && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-medium"
            style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
          >
            Coming soon
          </span>
        )}
      </div>
      {hasContent ? (
        children
      ) : (
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {empty}
        </p>
      )}
    </section>
  )
}

function SpotGrid({ relations }: { relations: RelationWithSpot[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {relations.map((rel) => {
        const spot = rel.spots
        if (!spot) return null
        return (
          <Link
            key={rel.id}
            href={`/spot/${spot.slug}`}
            className="block p-3 rounded-lg border transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-start gap-3">
              {spot.photos?.[0]?.url && (
                <Image
                  src={spot.photos[0].url}
                  alt={spot.name}
                  width={56}
                  height={56}
                  className="rounded-md object-cover shrink-0"
                  unoptimized
                />
              )}
              <div className="min-w-0 flex-1">
                <h3
                  className="text-[14px] font-semibold leading-tight truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {spot.name}
                </h3>
                <p className="text-[12px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {spot.neighborhood ?? spot.city}
                </p>
                {spot.workability_score != null && (
                  <p
                    className="text-[11px] mt-1 font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {Number(spot.workability_score).toFixed(1)}/10 workable
                  </p>
                )}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
