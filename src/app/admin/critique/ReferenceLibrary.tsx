'use client'

// ─────────────────────────────────────────────────────────────
// Reference library — outside sites used as design benchmarks
// during critique. Starts seeded with Nomad List + Puzzably
// (both cited in conversation); grows via the quick-add form.
// ─────────────────────────────────────────────────────────────

import { useState, useTransition } from 'react'
import type { ReferenceRow } from '@/lib/admin/reference-queries'
import { addReferenceAction } from './actions'

export default function ReferenceLibrary({ initial }: { initial: ReferenceRow[] }) {
  const [refs, setRefs] = useState(initial)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    if (!name.trim() || !url.trim() || !note.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await addReferenceAction({ name, url, note })
      if (!res.ok) {
        setError(res.error ?? 'failed to save')
        return
      }
      setRefs((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          name: name.trim(),
          url: url.trim(),
          note: note.trim(),
          image_path: null,
          added_by: 'donovan',
          created_at: new Date().toISOString(),
        },
      ])
      setName('')
      setUrl('')
      setNote('')
      setOpen(false)
    })
  }

  return (
    <section
      className="rounded-lg border p-5"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-sm font-medium"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
        >
          Reference library
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium px-2.5 py-1 rounded border"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
        >
          {open ? 'Cancel' : '+ Add reference'}
        </button>
      </div>

      {open ? (
        <div className="space-y-2 mb-4 p-3 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
          {error ? (
            <div className="text-[12px]" style={{ color: 'var(--no)' }}>
              {error}
            </div>
          ) : null}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name — e.g. Linear"
            className="w-full text-sm rounded border px-2 py-1.5"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="w-full text-sm rounded border px-2 py-1.5"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What specifically about it is the reference — not just the vibe."
            className="w-full text-sm rounded border p-2"
            style={{ borderColor: 'var(--border-subtle)', minHeight: 60 }}
          />
          <button
            onClick={save}
            disabled={pending || !name.trim() || !url.trim() || !note.trim()}
            className="text-xs px-3 py-1.5 rounded font-medium"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
          >
            Save
          </button>
        </div>
      ) : null}

      <div className="grid sm:grid-cols-2 gap-3">
        {refs.map((r) => (
          <a
            key={r.id}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border overflow-hidden block hover:opacity-90 transition-opacity"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {r.image_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.image_path} alt={r.name} className="w-full h-32 object-cover object-top" />
            ) : (
              <div
                className="w-full h-16 flex items-center justify-center text-[11px]"
                style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
              >
                no screenshot yet
              </div>
            )}
            <div className="p-3">
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {r.name}
              </div>
              <div className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {r.note}
              </div>
            </div>
          </a>
        ))}
        {refs.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            No references yet.
          </div>
        ) : null}
      </div>
    </section>
  )
}
