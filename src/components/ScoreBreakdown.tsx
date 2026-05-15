'use client'

import { useState } from 'react'
import { ScoreBreakdown as IScoreBreakdown } from '@/types/cafe'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  score: IScoreBreakdown
  reviewSamples?: string[]
  defaultOpen?: boolean
}

interface BarProps {
  label: string
  value: number
  max: number
  color: string
}

function ScoreBar({ label, value, max, color }: BarProps) {
  const pct = Math.round((value / max) * 100)
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>
          {value}/{max}
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--surface-3)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

const BAR_COLOR = (value: number, max: number): string => {
  const ratio = value / max
  if (ratio >= 0.7) return 'var(--yes)'
  if (ratio >= 0.45) return 'var(--kinda)'
  return 'var(--no)'
}

export function ScoreBreakdown({ score, reviewSamples = [], defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        className="w-full flex items-center justify-between text-xs py-2 transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        <span>Score breakdown</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div className="space-y-3 pb-2 fade-in">
          <div className="space-y-2">
            <ScoreBar
              label="Wi-Fi quality"
              value={score.wifi}
              max={30}
              color={BAR_COLOR(score.wifi, 30)}
            />
            <ScoreBar
              label="Outlets / power"
              value={score.outlets}
              max={20}
              color={BAR_COLOR(score.outlets, 20)}
            />
            <ScoreBar
              label="Noise level (quiet = higher)"
              value={score.noise}
              max={20}
              color={BAR_COLOR(score.noise, 20)}
            />
            <ScoreBar
              label="Overall rating"
              value={score.rating}
              max={15}
              color={BAR_COLOR(score.rating, 15)}
            />
            <ScoreBar
              label="Hours (late / early)"
              value={score.hours}
              max={15}
              color={BAR_COLOR(score.hours, 15)}
            />
          </div>

          {reviewSamples.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Review excerpts
              </p>
              {reviewSamples.map((r, i) => (
                <p
                  key={i}
                  className="text-[11px] leading-relaxed pl-2 border-l-2 italic"
                  style={{
                    color: 'var(--text-secondary)',
                    borderColor: 'var(--border)',
                  }}
                >
                  &ldquo;{r}&rdquo;
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
