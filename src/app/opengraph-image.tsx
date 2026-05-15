import { ImageResponse } from 'next/og'

// ── Open Graph share image ──
// Renders at build time via @vercel/og's Satori. This is the photo people
// see when they paste cafelist.app into iMessage / Slack / Twitter / LinkedIn.

export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Cafelist — Worth your time'

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#FAF7F2',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '80px 80px 72px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Brand row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            color: '#B5530F',
          }}
        >
          {/* Coffee mark */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#B5530F',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FAF7F2',
              fontSize: 32,
              fontWeight: 700,
            }}
          >
            ☕
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 600,
              color: '#1B1410',
              letterSpacing: '-0.02em',
            }}
          >
            Cafelist
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 128,
            fontWeight: 700,
            color: '#1B1410',
            marginTop: 64,
            lineHeight: 1.0,
            letterSpacing: '-0.04em',
            maxWidth: 980,
          }}
        >
          Worth your time.
        </div>

        {/* Subhead */}
        <div
          style={{
            fontSize: 30,
            color: '#5C4D40',
            marginTop: 32,
            lineHeight: 1.45,
            maxWidth: 920,
          }}
        >
          A handpicked directory of coffee shops and hotel lobbies actually good for working from.
          Wi-Fi, outlets, noise level, late hours — verified, not aggregated.
        </div>

        {/* Footer URL */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 'auto',
            paddingTop: 32,
            borderTop: '1px solid #E2D8C7',
            fontSize: 24,
            color: '#9C8C7B',
          }}
        >
          <span style={{ color: '#B5530F', fontWeight: 600 }}>cafelist.app</span>
          <span>148 NYC cafés · open now</span>
        </div>
      </div>
    ),
    { ...size }
  )
}
