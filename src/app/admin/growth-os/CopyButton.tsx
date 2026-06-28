'use client'

// ─────────────────────────────────────────────────────────────
// CopyButton — copies a command string to the clipboard.
// Co-located with the Growth OS admin surface.
// ─────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyButtonProps {
  text: string
  label?: string
}

export function CopyButton({ text, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for older browsers or non-secure contexts
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={copied ? 'Copied!' : `Copy: ${text}`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all"
      style={{
        backgroundColor: copied ? 'rgba(47,125,79,0.12)' : 'rgba(0,0,0,0.06)',
        color: copied ? 'var(--yes)' : 'var(--text-muted)',
        border: '1px solid transparent',
      }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : label}
    </button>
  )
}
