/**
 * /login — magic-link sign-in.
 *
 * Flow:
 *   1. User enters email, clicks "Send magic link"
 *   2. supabase.auth.signInWithOtp emails them a link
 *   3. Link points to /auth/callback?code=... which exchanges the code
 *      for a session and redirects to /
 *
 * Why magic link (not password): no password reset flow, no leaked-password
 * risk, no extra UI. One-time-use email link is plenty for friend testing.
 */

'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

// Next.js 16 requires useSearchParams() to be inside a Suspense boundary so
// the surrounding page can still be statically rendered. Split the form into
// a child component and wrap it.

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginInner />
    </Suspense>
  )
}

function LoginShell() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      </div>
    </div>
  )
}

function LoginInner() {
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') ?? '/'
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Forward ?next= through to /auth/callback so users land back where they
  // started after the auth round-trip (e.g. /spot/headrest-coffee).
  function callbackUrl() {
    const base = `${window.location.origin}/auth/callback`
    return nextPath && nextPath !== '/' ? `${base}?next=${encodeURIComponent(nextPath)}` : base
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    setStatus('sending')
    setErrorMsg('')

    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl() },
    })

    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
      return
    }
    setStatus('sent')
  }

  async function signInWithGoogle() {
    setStatus('sending')
    setErrorMsg('')
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl() },
    })
    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
    }
    // On success, supabase redirects the browser to Google — no further UI here.
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="wordmark text-[18px]" style={{ color: 'var(--text-primary)' }}>
              Cafelist
            </span>
          </Link>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
        {status === 'sent' ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-5xl">📬</span>
            <h1
              className="text-xl font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              Check your email
            </h1>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              We sent a sign-in link to <strong>{email}</strong>. Open it on this device
              to finish signing in. The link works once and expires in an hour.
            </p>
            <button
              onClick={() => {
                setStatus('idle')
                setEmail('')
              }}
              className="mt-2 text-[12px] underline"
              style={{ color: 'var(--accent)' }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h1
              className="text-xl font-semibold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Sign in
            </h1>
            <p
              className="text-sm mb-6 leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Enter your email and we&apos;ll send you a sign-in link. No password to
              remember.
            </p>

            {/* Google sign-in — primary path. One click, no email back-and-forth. */}
            <button
              onClick={signInWithGoogle}
              disabled={status === 'sending'}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed mb-4"
              style={{
                backgroundColor: 'white',
                borderColor: 'var(--border-subtle)',
                color: '#1c1c1e',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.61z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {status === 'sending' ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                or
              </span>
              <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
            </div>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wide font-medium" style={{ color: 'var(--text-muted)' }}>
                  Email
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === 'sending'}
                  className="px-3 py-2.5 rounded-lg border text-sm"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="you@example.com"
                />
              </label>

              <button
                type="submit"
                disabled={status === 'sending' || !email.trim()}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--accent)', color: 'white' }}
              >
                {status === 'sending' ? 'Sending…' : 'Send magic link'}
              </button>

              {status === 'error' && (
                <p className="text-[12px]" style={{ color: 'var(--no)' }}>
                  {errorMsg}
                </p>
              )}
            </form>

            <p
              className="text-[11px] mt-8 leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              By signing in you agree we&apos;ll associate the cafes you click and search
              with your account so we can make better recommendations.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
