'use client'

// ─────────────────────────────────────────────────────────────
// Box-select design feedback — drag a rectangle on the mockup,
// type the note, it's queued for a Claude session to batch-process.
// markup.io-style, scoped to cafelist's own admin.
// ─────────────────────────────────────────────────────────────

import { useMemo, useRef, useState, useTransition } from 'react'
import type { CritiqueFrame } from '@/lib/admin/critique-data'
import type { FeedbackRow } from '@/lib/admin/critique-queries'
import {
  addFeedbackAction,
  queueFeedbackAction,
  reopenFeedbackAction,
} from './actions'

type Box = { x: number; y: number; w: number; h: number }

const STATUS_COLOR: Record<FeedbackRow['status'], string> = {
  pending: 'var(--no)',
  queued: 'var(--kinda)',
  resolved: 'var(--yes)',
  needs_review: 'var(--accent)',
}

const STATUS_LABEL: Record<FeedbackRow['status'], string> = {
  pending: 'pending',
  queued: 'queued for fix',
  resolved: 'resolved',
  needs_review: 'needs your call',
}

export default function CritiqueBoard({
  frames,
  initialFeedback,
}: {
  frames: CritiqueFrame[]
  initialFeedback: FeedbackRow[]
}) {
  const iterations = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    frames.forEach((f) => {
      if (!seen.has(f.iterationLabel)) {
        seen.add(f.iterationLabel)
        out.push(f.iterationLabel)
      }
    })
    return out
  }, [frames])

  const [activeIteration, setActiveIteration] = useState(iterations[0] ?? '')
  const framesForIteration = frames.filter((f) => f.iterationLabel === activeIteration)
  const [activeFrameId, setActiveFrameId] = useState<string | undefined>(framesForIteration[0]?.id)
  const frame = frames.find((f) => f.id === activeFrameId) ?? framesForIteration[0]

  const [feedback, setFeedback] = useState(initialFeedback)
  const frameFeedback = feedback.filter((f) => f.image_path === frame?.imagePath)

  const [draft, setDraft] = useState<Box | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedForQueue, setSelectedForQueue] = useState<Set<string>>(new Set())
  const [groupLabel, setGroupLabel] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const imgRef = useRef<HTMLImageElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  function pctFromEvent(e: React.MouseEvent): { x: number; y: number } {
    const rect = imgRef.current!.getBoundingClientRect()
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    setSelectedId(null)
    const p = pctFromEvent(e)
    dragStart.current = p
    setIsDragging(true)
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 })
    setDraftNote('')
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragStart.current) return
    const p = pctFromEvent(e)
    const x = Math.min(dragStart.current.x, p.x)
    const y = Math.min(dragStart.current.y, p.y)
    const w = Math.abs(p.x - dragStart.current.x)
    const h = Math.abs(p.y - dragStart.current.y)
    setDraft({ x, y, w, h })
  }

  function onMouseUp() {
    if (!draft) return
    dragStart.current = null
    setIsDragging(false)
    // enforce a minimum visible box so a plain click still registers
    if (draft.w < 2 || draft.h < 2) {
      setDraft({
        x: Math.max(0, draft.x - 2),
        y: Math.max(0, draft.y - 2),
        w: 4,
        h: 4,
      })
    }
  }

  function cancelDraft() {
    setDraft(null)
    setDraftNote('')
  }

  function saveDraft() {
    if (!draft || !draftNote.trim() || !frame) return
    setError(null)
    startTransition(async () => {
      const res = await addFeedbackAction({
        frameId: frame.id,
        bbox: draft,
        note: draftNote.trim(),
      })
      if (!res.ok) {
        setError(res.error ?? 'failed to save')
        return
      }
      // optimistic local add — server data will reconcile on next load
      setFeedback((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          project: frame.project,
          iteration_label: frame.iterationLabel,
          frame_label: frame.frameLabel,
          image_path: frame.imagePath,
          bbox: draft,
          note: draftNote.trim(),
          author: 'donovan',
          status: 'pending',
          group_label: null,
          resolution: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
        },
      ])
      setDraft(null)
      setDraftNote('')
    })
  }

  function toggleQueueSelect(id: string) {
    setSelectedForQueue((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function sendGroupToQueue() {
    const ids = Array.from(selectedForQueue)
    if (ids.length === 0 || !groupLabel.trim()) return
    startTransition(async () => {
      const res = await queueFeedbackAction(ids, groupLabel.trim())
      if (!res.ok) {
        setError(res.error ?? 'failed to queue')
        return
      }
      setFeedback((prev) =>
        prev.map((f) =>
          ids.includes(f.id) ? { ...f, status: 'queued', group_label: groupLabel.trim() } : f
        )
      )
      setSelectedForQueue(new Set())
      setGroupLabel('')
    })
  }

  function reopen(id: string) {
    startTransition(async () => {
      await reopenFeedbackAction(id)
      setFeedback((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'pending', group_label: null, resolution: null } : f
        )
      )
    })
  }

  const pendingRows = feedback.filter((f) => f.status === 'pending')
  const queuedRows = feedback.filter((f) => f.status === 'queued')
  const otherRows = feedback.filter((f) => f.status === 'resolved' || f.status === 'needs_review')

  return (
    <div>
      {/* iteration tabs */}
      <div className="flex gap-2 flex-wrap mb-3">
        {iterations.map((it) => (
          <button
            key={it}
            onClick={() => {
              setActiveIteration(it)
              const first = frames.find((f) => f.iterationLabel === it)
              setActiveFrameId(first?.id)
              setDraft(null)
              setSelectedId(null)
            }}
            className="text-xs font-medium px-3 py-1.5 rounded-full border transition-opacity hover:opacity-80"
            style={{
              borderColor: 'var(--border-subtle)',
              backgroundColor: it === activeIteration ? 'var(--accent)' : 'var(--surface-2)',
              color: it === activeIteration ? 'var(--surface)' : 'var(--text-secondary)',
            }}
          >
            {it}
          </button>
        ))}
      </div>

      {/* frame tabs within iteration */}
      {framesForIteration.length > 1 ? (
        <div className="flex gap-2 flex-wrap mb-4">
          {framesForIteration.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setActiveFrameId(f.id)
                setDraft(null)
                setSelectedId(null)
              }}
              className="text-[11px] font-medium px-2.5 py-1 rounded border"
              style={{
                borderColor: 'var(--border-subtle)',
                backgroundColor: f.id === activeFrameId ? 'var(--accent-glow)' : 'transparent',
                color: f.id === activeFrameId ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {f.frameLabel}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div
          className="text-[12px] mb-3 p-2 rounded"
          style={{ backgroundColor: 'rgba(168,57,47,0.08)', color: 'var(--no)' }}
        >
          {error}
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
        {/* canvas */}
        <div
          className="relative inline-block select-none rounded-lg overflow-hidden border"
          style={{ borderColor: 'var(--border-subtle)', maxWidth: '100%' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={frame.imagePath}
              alt={frame.frameLabel}
              draggable={false}
              style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair' }}
            />
          ) : null}

          {frameFeedback.map((f, idx) => (
            <button
              key={f.id}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedId(f.id)
                setDraft(null)
              }}
              className="absolute"
              style={{
                left: `${f.bbox.x}%`,
                top: `${f.bbox.y}%`,
                width: `${f.bbox.w}%`,
                height: `${f.bbox.h}%`,
                border: `2px solid ${STATUS_COLOR[f.status]}`,
                backgroundColor:
                  f.id === selectedId ? `${STATUS_COLOR[f.status]}22` : 'transparent',
                borderRadius: 2,
              }}
              title={f.note}
            >
              <span
                className="absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center"
                style={{ backgroundColor: STATUS_COLOR[f.status], color: '#fff' }}
              >
                {idx + 1}
              </span>
            </button>
          ))}

          {draft ? (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${draft.x}%`,
                top: `${draft.y}%`,
                width: `${draft.w}%`,
                height: `${draft.h}%`,
                border: '2px dashed var(--accent)',
                backgroundColor: 'rgba(59,110,165,0.12)',
              }}
            />
          ) : null}
        </div>

        {/* side panel */}
        <div className="space-y-4 min-w-0">
          {draft && !isDragging ? (
            <div
              className="rounded-lg border p-3 space-y-2"
              style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--surface)' }}
            >
              <div
                className="text-[10px] uppercase tracking-wide font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                New annotation
              </div>
              <textarea
                autoFocus
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="What needs to change in this box?"
                className="w-full text-sm rounded border p-2"
                style={{ borderColor: 'var(--border-subtle)', minHeight: 70 }}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={cancelDraft}
                  className="text-xs px-3 py-1.5 rounded border"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveDraft}
                  disabled={pending || !draftNote.trim()}
                  className="text-xs px-3 py-1.5 rounded font-medium"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
                >
                  Drop it
                </button>
              </div>
            </div>
          ) : null}

          {selectedId
            ? (() => {
                const f = feedback.find((x) => x.id === selectedId)
                if (!f) return null
                return (
                  <div
                    className="rounded-lg border p-3 space-y-2"
                    style={{ borderColor: STATUS_COLOR[f.status], backgroundColor: 'var(--surface)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${STATUS_COLOR[f.status]}22`,
                          color: STATUS_COLOR[f.status],
                        }}
                      >
                        {STATUS_LABEL[f.status]}
                      </span>
                      {f.group_label ? (
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          group: {f.group_label}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {f.note}
                    </div>
                    {f.resolution ? (
                      <div
                        className="text-[12px] p-2 rounded"
                        style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                      >
                        <strong>Resolution:</strong> {f.resolution}
                      </div>
                    ) : null}
                    {f.status !== 'pending' ? (
                      <button
                        onClick={() => reopen(f.id)}
                        className="text-xs px-3 py-1.5 rounded border"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                      >
                        Reopen
                      </button>
                    ) : null}
                  </div>
                )
              })()
            : null}

          {pendingRows.length > 0 ? (
            <div
              className="rounded-lg border p-3 space-y-2"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div
                className="text-[10px] uppercase tracking-wide font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                Pending ({pendingRows.length}) — select, then group &amp; queue
              </div>
              <ul className="space-y-1.5">
                {pendingRows.map((f) => (
                  <li key={f.id} className="flex items-start gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={selectedForQueue.has(f.id)}
                      onChange={() => toggleQueueSelect(f.id)}
                      className="mt-0.5"
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{f.frame_label}</strong> —{' '}
                      {f.note}
                    </span>
                  </li>
                ))}
              </ul>
              {selectedForQueue.size > 0 ? (
                <div className="pt-2 space-y-1.5">
                  <input
                    value={groupLabel}
                    onChange={(e) => setGroupLabel(e.target.value)}
                    placeholder="Group label — e.g. R2 hero + copy fixes"
                    className="w-full text-xs rounded border px-2 py-1.5"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  />
                  <button
                    onClick={sendGroupToQueue}
                    disabled={pending || !groupLabel.trim()}
                    className="text-xs px-3 py-1.5 rounded font-medium w-full"
                    style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
                  >
                    Queue {selectedForQueue.size} item{selectedForQueue.size === 1 ? '' : 's'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {queuedRows.length > 0 ? (
            <div
              className="rounded-lg border p-3 space-y-1.5"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div
                className="text-[10px] uppercase tracking-wide font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                Queued ({queuedRows.length}) — picked up next time a Claude session processes this
              </div>
              {Object.entries(
                queuedRows.reduce<Record<string, FeedbackRow[]>>((acc, r) => {
                  const k = r.group_label ?? '(ungrouped)'
                  acc[k] = acc[k] ?? []
                  acc[k].push(r)
                  return acc
                }, {})
              ).map(([group, rows]) => (
                <div key={group} className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{group}</strong> — {rows.length}{' '}
                  item{rows.length === 1 ? '' : 's'}
                </div>
              ))}
            </div>
          ) : null}

          {otherRows.length > 0 ? (
            <div
              className="rounded-lg border p-3 space-y-1.5"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div
                className="text-[10px] uppercase tracking-wide font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                Resolved / needs review
              </div>
              <ul className="space-y-1">
                {otherRows.map((f) => (
                  <li key={f.id} className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: STATUS_COLOR[f.status] }}>●</span> {f.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
