'use client'

import { useEffect } from 'react'
import { CafeRecord } from '@/types/cafe'
import { X, MapPin, Clock, ExternalLink, Star, Wifi, Volume2, Plug } from 'lucide-react'

interface Props {
  cafe: CafeRecord
  onClose: () => void
}

function ScoreBar({ label, icon, value, max, color }: {
  label: string; icon: React.ReactNode; value: number; max: number; color: string
}) {
  const pct = Math.round((value / max) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-28 shrink-0">
        {icon}
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <div className="flex-1 h-8 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
        <div
          className="h-full rounded-full flex items-center justify-end pr-3 transition-all"
          style={{ width: `${Math.max(pct, 8)}%`, backgroundColor: color }}
        >
          <span className="text-xs font-bold text-white">{pct}%</span>
        </div>
      </div>
    </div>
  )
}

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'] as const

function todayHours(cafe: CafeRecord): string | null {
  const today = DAY_NAMES[new Date().getDay()]
  const h = cafe.hours[today]
  if (h === undefined) return null
  return h === null ? 'Closed today' : h
}

export function CafeModal({ cafe, onClose }: Props) {
  const hours = todayHours(cafe)
  const photo = cafe.photos[0] ?? null

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const { wifi, outlets, noise, rating, hours: hoursScore, total } = cafe.score
  const totalColor = total >= 70 ? 'var(--yes)' : total >= 50 ? 'var(--kinda)' : total >= 30 ? 'var(--kinda)' : 'var(--no)'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: '#141414', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Photo header ── */}
        <div className="relative h-52 shrink-0">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={cafe.name} className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{
              background: `linear-gradient(135deg, hsl(${(cafe.name.charCodeAt(0) * 7) % 360},40%,15%) 0%, hsl(${(cafe.name.charCodeAt(0) * 11) % 360},35%,10%) 100%)`
            }} />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)' }} />

          {/* Close */}
          <button onClick={onClose}
            className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
            <X size={16} style={{ color: 'white' }} />
          </button>

          {/* Name + location */}
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
            <h2 className="text-xl font-bold text-white leading-tight mb-1">{cafe.name}</h2>
            <div className="flex items-center gap-1.5">
              <MapPin size={12} className="text-white/60" />
              <span className="text-sm text-white/70">{cafe.neighborhood ?? cafe.city}</span>
              {cafe.rating > 0 && (
                <>
                  <span className="text-white/30">·</span>
                  <Star size={11} className="text-yellow-400" />
                  <span className="text-sm text-white/70">{cafe.rating.toFixed(1)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-5 space-y-5">

          {/* Overall score */}
          <div className="flex items-center justify-between py-3 px-4 rounded-xl"
            style={{ backgroundColor: `${totalColor}18`, border: `1px solid ${totalColor}30` }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Work Score</span>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-black" style={{ color: totalColor }}>{total}</span>
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: totalColor }}>
                {total >= 70 ? 'Great' : total >= 50 ? 'Good' : total >= 30 ? 'Fair' : 'Poor'}
              </span>
            </div>
          </div>

          {/* Score bars */}
          <div className="space-y-3">
            <ScoreBar label="Wi-Fi"   icon={<Wifi size={14} style={{ color: 'var(--accent)' }} />}   value={wifi}    max={30} color="var(--accent)" />
            <ScoreBar label="Outlets" icon={<Plug size={14} style={{ color: 'var(--kinda)' }} />}   value={outlets} max={20} color="var(--kinda)" />
            <ScoreBar label="Noise"   icon={<Volume2 size={14} style={{ color: 'var(--yes)' }} />} value={noise}   max={20} color="var(--yes)" />
            <ScoreBar label="Rating"  icon={<Star size={14} style={{ color: '#3b82f6' }} />}   value={rating}  max={15} color="#3b82f6" />
            <ScoreBar label="Hours"   icon={<Clock size={14} style={{ color: '#ec4899' }} />}  value={hoursScore} max={15} color="#ec4899" />
          </div>

          {/* Today hours */}
          {hours && (
            <div className="flex items-center gap-2 text-sm"
              style={{ color: hours === 'Closed today' ? 'var(--no)' : 'var(--text-secondary)' }}>
              <Clock size={14} />
              <span>{hours}</span>
            </div>
          )}

          {/* Address */}
          {cafe.address && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{cafe.address}</p>
          )}

          {/* Signals */}
          {cafe.topSignals.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {cafe.topSignals.map((sig) => (
                <span key={sig.type}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{
                    backgroundColor: sig.positive ? 'rgba(47,125,79,0.15)' : 'rgba(168,57,47,0.15)',
                    color: sig.positive ? 'var(--yes)' : 'var(--no)',
                    border: `1px solid ${sig.positive ? 'rgba(47,125,79,0.3)' : 'rgba(168,57,47,0.3)'}`,
                  }}>
                  {sig.icon} {sig.label}
                </span>
              ))}
            </div>
          )}

          {/* Review samples */}
          {cafe.reviewSamples.length > 0 && (
            <div className="space-y-2">
              {cafe.reviewSamples.slice(0, 2).map((r, i) => (
                <p key={i} className="text-xs leading-relaxed italic"
                  style={{ color: 'var(--text-muted)', borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                  "{r}"
                </p>
              ))}
            </div>
          )}

          {/* Google Maps button */}
          {cafe.googleMapsUrl && (
            <a href={cafe.googleMapsUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: 'var(--accent)', color: 'white' }}>
              <ExternalLink size={14} />
              Open in Google Maps
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
