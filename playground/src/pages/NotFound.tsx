import { Link } from '../router'

export function NotFound() {
  return (
    <section className="section">
      <h1>Page not found</h1>
      <p className="lead">
        This page does not exist. <Link to="/">Back to the home page</Link>.
      </p>
    </section>
  )
}
