'use client'

/**
 * UserMenu — top-bar auth controls. Shows "Sign in" when anonymous,
 * "{email-prefix} · Sign out" when authenticated. Client component so
 * it can react to auth state changes (e.g. signing out without a refresh).
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { logEvent } from '@/lib/events'
import type { User } from '@supabase/supabase-js'

export function UserMenu({ initialUser }: { initialUser: User | null }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(initialUser)
  const supabase = createSupabaseBrowserClient()

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (event === 'SIGNED_IN') logEvent('sign_in')
    })
    return () => subscription.subscription.unsubscribe()
  }, [supabase])

  async function signOut() {
    logEvent('sign_out')
    await supabase.auth.signOut()
    router.refresh()
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-[11px] font-medium transition-opacity hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
      >
        Sign in
      </Link>
    )
  }

  const emailPrefix = user.email?.split('@')[0] ?? 'you'

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        {emailPrefix}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>·</span>
      <button
        onClick={signOut}
        className="text-[11px] font-medium transition-opacity hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
      >
        Sign out
      </button>
    </div>
  )
}
