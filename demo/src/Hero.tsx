const PLANTS = [
  { name: 'Monstera', note: 'Water in 2 days', tone: 'sage' },
  { name: 'Fiddle-leaf fig', note: 'Watered today', tone: 'done' },
  { name: 'Calathea', note: 'Mist this evening', tone: 'clay' },
]

function Illustration() {
  return (
    <div className="art" aria-hidden="true">
      <svg viewBox="0 0 420 420" className="art-svg">
        <circle cx="210" cy="210" r="190" fill="var(--sage-soft)" />
        <circle cx="300" cy="110" r="46" fill="var(--sun)" opacity="0.85" />
        {/* The leaves: one path, turned. */}
        <g transform="translate(210 250)">
          {[-58, -24, 8, 40, 70].map((angle, i) => (
            <g key={angle} transform={`rotate(${angle})`}>
              <path
                d={`M0 0 C ${-40 - i * 4} -60 ${-30} -150 0 -${170 - i * 12} C 30 -150 ${40 + i * 4} -60 0 0Z`}
                fill={i % 2 ? 'var(--leaf)' : 'var(--forest)'}
              />
              <path d={`M0 0 L0 -${150 - i * 12}`} stroke="var(--sage)" strokeWidth="3" />
            </g>
          ))}
        </g>
        {/* The pot. */}
        <path
          d="M140 250h140l-18 110a14 14 0 0 1-14 12h-76a14 14 0 0 1-14-12Z"
          fill="var(--clay)"
        />
        <rect x="130" y="238" width="160" height="26" rx="8" fill="var(--clay-deep)" />
      </svg>
      <ul className="art-cards">
        {PLANTS.map((plant) => (
          <li key={plant.name} className={`art-card art-card--${plant.tone}`}>
            <span className="art-dot" />
            <span>
              <strong>{plant.name}</strong>
              <small>{plant.note}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-inner">
        <div className="hero-copy">
          <p className="eyebrow">Plant care that remembers</p>
          <h1>
            Your plants,
            <br />
            happy and healty.
          </h1>
          <p className="lede">
            Mossbloom learns each plant’s light, soil and season, then tells you when to
            water, feed and repot. Nothing to track, nothing to forget.
          </p>
          <div className="hero-actions">
            <a href="#features" className="btn-start">
              Start growing
            </a>
            <a href="#features" className="link-more">
              See how it works →
            </a>
          </div>
          <p className="hero-proof">
            <span className="stars" aria-hidden="true">
              ★★★★★
            </span>
            Loved by 40,000 plant parents
          </p>
        </div>
        <Illustration />
      </div>
    </section>
  )
}
