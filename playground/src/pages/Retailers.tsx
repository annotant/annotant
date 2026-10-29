import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { OPENING_SOON, RETAILERS } from '../data'

const SORTS = { name: 'Name', city: 'City', since: 'Since' } as const
type Sort = keyof typeof SORTS
const SORT_KEYS: Sort[] = ['name', 'city', 'since']

/** Mounted before the app's root, as some modal libraries do: earlier in the DOM than the page it covers. */
function Portal({ children }: { children: ReactNode }) {
  const [host] = useState(() => document.createElement('div'))
  useEffect(() => {
    document.body.prepend(host)
    return () => host.remove()
  }, [host])
  return createPortal(children, host)
}

export function Retailers() {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [sorting, setSorting] = useState(false)
  const [newest, setNewest] = useState(false)
  const needle = query.trim().toLowerCase()
  const shown = RETAILERS.filter((retailer) =>
    [retailer.name, retailer.city, retailer.country].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  ).toSorted((a, b) =>
    sort === 'since' ? a.since - b.since : a[sort].localeCompare(b[sort]),
  )
  const latest = RETAILERS.toSorted((a, b) => b.since - a.since).slice(0, 3)

  return (
    <>
      <section className="section">
        <h1>Retailers</h1>
        <p className="lead">
          Our coffee is poured and sold in {RETAILERS.length} cafés around the world. Each
          of them grinds it to order.
        </p>
      </section>

      <section className="section">
        <label className="field field--inline">
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="Name, city or country"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="toolbar">
          <div className="menu">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              aria-expanded={sorting}
              onClick={() => setSorting(!sorting)}
            >
              Sort by: {SORTS[sort]}
            </button>
            {sorting && (
              <ul className="menu-list">
                {SORT_KEYS.map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => {
                        setSort(key)
                        setSorting(false)
                      }}
                    >
                      {SORTS[key]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setNewest(true)}
          >
            Newest cafés
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">City</th>
                <th scope="col">Country</th>
                <th scope="col">Beans</th>
                <th scope="col" className="num">
                  Since
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((retailer) => (
                <tr key={retailer.name}>
                  <th scope="row">{retailer.name}</th>
                  <td>{retailer.city}</td>
                  <td>{retailer.country}</td>
                  <td>
                    {retailer.beans.map((bean) => (
                      <span key={bean} className="chip">
                        {bean}
                      </span>
                    ))}
                  </td>
                  <td className="num">{retailer.since}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No retailer matches “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Opening soon</h2>
        <ul className="list">
          {OPENING_SOON.map((place) => (
            <li key={place}>{place}</li>
          ))}
        </ul>
      </section>

      {newest && (
        <Portal>
          <div className="overlay">
            <div className="modal card" role="dialog" aria-labelledby="newest-title">
              <h2 id="newest-title">Newest cafés</h2>
              <ul className="list">
                {latest.map((retailer) => (
                  <li key={retailer.name}>
                    {retailer.name}, {retailer.city} (since {retailer.since})
                  </li>
                ))}
              </ul>
              <div className="actions">
                <button type="button" className="btn" onClick={() => setNewest(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}
