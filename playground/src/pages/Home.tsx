import { ORIGINS } from '../data'
import { Link } from '../router'

export function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Small-batch, since 2018</p>
        <h1>Coffee roasted the week you drink it</h1>
        <p className="lead">
          We buy green coffee from three farms we know by name, roast it on Tuesdays and
          ship it on Wednesdays. No warehouse, no stale bags.
        </p>
        <div className="actions">
          <Link to="/retailers" className="btn">
            Find a retailer
          </Link>
          <Link to="/contact" className="btn btn--secondary">
            Ask us anything
          </Link>
        </div>
      </section>

      <section className="section">
        <h2>Our origins</h2>
        <div className="cards">
          {ORIGINS.map((origin) => (
            <article key={origin.name} className="card">
              <span className="chip">{origin.region}</span>
              <h3>{origin.name}</h3>
              <p>{origin.notes}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>How a subscription works</h2>
        <ol className="steps">
          <li>
            <strong>Pick your beans.</strong> One origin, or let us rotate them every
            month.
          </li>
          <li>
            <strong>Choose a grind.</strong> Whole bean, espresso, filter or French press.
          </li>
          <li>
            <strong>Get it fresh.</strong> Every bag ships within two days of roasting.
          </li>
        </ol>
        <p className="pricing">
          Plans start at <strong>$14</strong> per <em>250 g bag</em>, with{' '}
          <span className="highlight">free shipping</span> from two bags, and you can{' '}
          <Link to="/contact">pause or cancel</Link> at any time.
        </p>
      </section>
    </>
  )
}
