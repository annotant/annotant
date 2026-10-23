const FEATURES = [
  {
    icon: '💧',
    title: 'Watering, timed',
    text: 'Reminders that follow the weather in your window, not a fixed calendar.',
  },
  {
    icon: '🌿',
    title: 'A diary per plant',
    text: 'Photos, new leaves and repots, so you see each one grow over the year.',
    badge: 'New',
  },
  {
    icon: '☀️',
    title: 'Light, measured',
    text: 'Point your phone at a spot: Mossbloom tells you which plants will thrive there.',
  },
]

export function Features() {
  return (
    <section className="features" id="features">
      <div className="container">
        <h2>Everything a plant would ask for</h2>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="feature">
              <span className="feature-icon" aria-hidden="true">
                {feature.icon}
              </span>
              <h3>
                {feature.title}
                {feature.badge ? <span className="badge">{feature.badge}</span> : null}
              </h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
