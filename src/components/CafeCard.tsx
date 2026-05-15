'use client'

import { useState } from 'react'
import { CafeRecord } from '@/types/cafe'
import { MapPin, Wifi, Volume2, Star } from 'lucide-react'
import { CafeModal } from './CafeModal'

function nameToGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${hue},40%,18%) 0%, hsl(${(hue + 40) % 360},35%,12%) 100%)`
}

function scoreColor(n: number) {
  if (n >= 70) return 'var(--yes)'
  if (n >= 50) return 'var(--kinda)'
  if (n >= 30) return 'var(--kinda)'
  return 'var(--no)'
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100)
  return (
    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: color }} />
    </div>
  )
}

interface Props {
  cafe: CafeRecord
  rank: number
}

export function CafeCard({ cafe, rank }: Props) {
  const [imgFailed, setImgFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const photo = cafe.photos[0] ?? null
  const color = scoreColor(cafe.score.total)

  return (
    <>
      <article
        onClick={() => setOpen(true)}
        className="spot-card rounded-2xl overflow-hidden cursor-pointer group"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
      >
        {/* ── Photo ── */}
        <div className="relative h-44 overflow-hidden">
          {photo && !imgFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={cafe.name}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={() => setImgFailed(true)}
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105"
              style={{ background: nameToGradient(cafe.name) }} />
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.05) 55%, transparent 100%)'
          }} />

          {/* Rank */}
          <div className="absolute top-2.5 left-2.5 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black text-white"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
            {rank}
          </div>

          {/* Score badge */}
          <div className="absolute top-2.5 right-2.5 flex flex-col items-center px-2 py-1 rounded-lg"
            style={{ backgroundColor: color }}>
            <span className="text-base font-black leading-none text-white">{cafe.score.total}</span>
          </div>

          {/* Name */}
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5">
            <h3 className="font-bold text-sm text-white leading-snug line-clamp-1">{cafe.name}</h3>
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin size={9} className="text-white/50 shrink-0" />
              <span className="text-[11px] text-white/60 truncate">{cafe.neighborhood ?? cafe.city}</span>
              {cafe.rating > 0 && (
                <>
                  <Star size={9} className="text-yellow-400 ml-1 shrink-0" />
                  <span className="text-[11px] text-white/60">{cafe.rating.toFixed(1)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Score bars ── */}
        <div className="px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Wifi size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span className="text-[10px] w-10 shrink-0" style={{ color: 'var(--text-muted)' }}>Wi-Fi</span>
            <MiniBar value={cafe.score.wifi} max={30} color="var(--accent)" />
          </div>
          <div className="flex items-center gap-2">
            <Volume2 size={11} style={{ color: 'var(--yes)', flexShrink: 0 }} />
            <span className="text-[10px] w-10 shrink-0" style={{ color: 'var(--text-muted)' }}>Noise</span>
            <MiniBar value={cafe.score.noise} max={20} color="var(--yes)" />
          </div>
          <div className="flex items-center gap-2">
            <Star size={11} style={{ color: '#3b82f6', flexShrink: 0 }} />
            <span className="text-[10px] w-10 shrink-0" style={{ color: 'var(--text-muted)' }}>Rating</span>
            <MiniBar value={cafe.score.rating} max={15} color="#3b82f6" />
          </div>
        </div>
      </article>

      {open && <CafeModal cafe={cafe} onClose={() => setOpen(false)} />}
    </>
  )
}
