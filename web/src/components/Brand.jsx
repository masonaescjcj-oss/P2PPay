export function TetherMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="var(--tether)" />
      <rect x="8" y="8" width="16" height="3.6" rx="1" fill="#fff" />
      <rect x="14" y="8" width="4" height="17" rx="1" fill="#fff" />
      <ellipse cx="16" cy="15.6" rx="8.5" ry="2.6" fill="none" stroke="#fff" strokeWidth="1.8" />
    </svg>
  )
}

export function StarMark({ size = 34, color = 'var(--accent-text)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <rect x="7" y="7" width="20" height="20" fill="none" stroke={color} strokeWidth="1.6" />
      <rect x="7" y="7" width="20" height="20" fill="none" stroke={color} strokeWidth="1.6" transform="rotate(45 17 17)" />
      <circle cx="17" cy="17" r="4" fill="var(--accent)" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <div dir="ltr" style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.2 }}>
      P<span style={{ color: 'var(--accent-text)' }}>2</span>PPay
    </div>
  )
}

// Eight-point-star (girih) tiling used on the balance card.
export function Girih({ id = 'girih' }) {
  return (
    <svg className="girih" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <pattern id={id} width="44" height="44" patternUnits="userSpaceOnUse">
          <rect x="11" y="11" width="22" height="22" fill="none" stroke="#E9B44C" strokeWidth="0.9" />
          <rect x="11" y="11" width="22" height="22" fill="none" stroke="#E9B44C" strokeWidth="0.9" transform="rotate(45 22 22)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}
