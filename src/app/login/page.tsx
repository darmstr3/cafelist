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

import { useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    setStatus('sending')
    setErrorMsg('')

    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
      return
    }
    setStatus('sent')
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

            <form onSubmit={submit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wide font-medium" style={{ color: 'var(--text-muted)' }}>
                  Email
                </span>
                <input
                  type="email"
                  required
                  autoFocus
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
