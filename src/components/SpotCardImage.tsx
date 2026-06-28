'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Coffee } from 'lucide-react'

// Cover image for a spot card. Many cover URLs are hotlinked Google Places
// photo references that expire or get referrer-blocked; when one fails to
// load the browser would otherwise render the <img> alt text over the gray
// fallback area ("name bleeding through the card"). Catching onError and
// swapping to the clean Coffee placeholder keeps the card layout intact.

interface SpotCardImageProps {
  src: string | null
  alt: string
}

function CoffeePlaceholder() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ color: 'var(--text-muted)', opacity: 0.4 }}
    >
      <Coffee size={36} strokeWidth={1.2} />
    </div>
  )
}

export function SpotCardImage({ src, alt }: SpotCardImageProps) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) return <CoffeePlaceholder />

  // onError swaps to the placeholder the instant a hotlinked Google Places
  // URL 403s/expires, so the broken <img>+alt-text state never persists on
  // the card (that was the "name bleeding over the image" bug).
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
      className="object-cover"
      unoptimized
      onError={() => setFailed(true)}
    />
  )
}
