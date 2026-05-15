// Server component. Renders a small inline-SVG line chart so the
// /labs/eval page can plot trends over runs without adding a chart
// library to the dep tree.

export interface LinePoint {
  /** X-axis label (typically a short date or run index). */
  label: string
  /** Numeric value. */
  value: number
  /** Optional tooltip-style hover title. */
  title?: string
}

export interface LineChartProps {
  data: LinePoint[]
  /** Lower bound of the y-axis. Defaults to data min, with padding. */
  yMin?: number
  /** Upper bound of the y-axis. Defaults to data max, with padding. */
  yMax?: number
  /** Chart height in px. Width is 100% of parent. */
  height?: number
  /** Format the y-axis tick labels. */
  formatY?: (v: number) => string
  /** Optional title above the chart. */
  title?: string
  /** Optional caption shown below the chart. */
  caption?: string
  /** Color CSS variable used for the line. */
  strokeVar?: string
}

const W = 600 // viewBox width; SVG scales via 100% width
const PAD_L = 40
const PAD_R = 12
const PAD_T = 16
const PAD_B = 26

export function LineChart({
  data,
  yMin,
  yMax,
  height = 180,
  formatY = (v) => v.toFixed(2),
  title,
  caption,
  strokeVar = '--accent',
}: LineChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="rounded-md border p-4 text-xs"
        style={{
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        {title ? <div className="font-medium mb-1">{title}</div> : null}
        No data yet — run <code>npm run eval</code> to populate.
      </div>
    )
  }

  const values = data.map((d) => d.value)
  const observedMin = Math.min(...values)
  const observedMax = Math.max(...values)
  const lo = yMin ?? Math.max(0, observedMin - (observedMax - observedMin) * 0.2 || 0)
  const hi = yMax ?? observedMax + (observedMax - observedMin) * 0.2 || observedMax + 1
  const range = Math.max(0.0001, hi - lo)

  const innerW = W - PAD_L - PAD_R
  const innerH = height - PAD_T - PAD_B
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0

  const points = data.map((d, i) => {
    const x = PAD_L + i * stepX
    const y = PAD_T + innerH - ((d.value - lo) / range) * innerH
    return { x, y, label: d.label, value: d.value, title: d.title }
  })

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  // y ticks: 4 evenly-spaced lines.
  const ticks = [0, 1, 2, 3].map((i) => {
    const t = lo + (range * i) / 3
    const y = PAD_T + innerH - ((t - lo) / range) * innerH
    return { t, y }
  })

  return (
    <div>
      {title ? (
        <div
          className="text-[11px] font-medium uppercase tracking-wide mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          {title}
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${height}`}
        width="100%"
        height={height}
        style={{ overflow: 'visible' }}
        role="img"
        aria-label={title ?? 'line chart'}
      >
        {/* gridlines */}
        {ticks.map((g, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={g.y}
              y2={g.y}
              stroke="var(--border-subtle)"
              strokeDasharray="2 3"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={g.y + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {formatY(g.t)}
            </text>
          </g>
        ))}

        {/* line */}
        <path
          d={pathD}
          fill="none"
          stroke={`var(${strokeVar})`}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={2.5}
              fill={`var(${strokeVar})`}
              stroke="var(--background)"
              strokeWidth={1}
            >
              <title>{p.title ?? `${p.label}: ${formatY(p.value)}`}</title>
            </circle>
          </g>
        ))}

        {/* x labels — only every other on dense charts */}
        {points.map((p, i) => {
          const showEvery = points.length > 8 ? 2 : 1
          if (i % showEvery !== 0 && i !== points.length - 1) return null
          return (
            <text
              key={i}
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {p.label}
            </text>
          )
        })}
      </svg>
      {caption ? (
        <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
          {caption}
        </div>
      ) : null}
    </div>
  )
}
