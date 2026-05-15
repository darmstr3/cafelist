'use client'

import { Search, X } from 'lucide-react'
import { useRef } from 'react'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchBar({ value, onChange, placeholder = 'Search by neighborhood or name…' }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="relative w-full max-w-2xl">
      <Search
        size={16}
        className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-10"
        style={{ color: 'var(--text-muted)', left: '14px' }}
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl text-sm border transition-all"
        style={{
          backgroundColor: 'var(--surface-2)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
          height: '48px',
          // Inline styles beat any cascade layer — no padding-conflict possible.
          paddingLeft: '40px',
          paddingRight: '36px',
          paddingTop: '12px',
          paddingBottom: '12px',
        }}
      />
      {value && (
        <button
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
