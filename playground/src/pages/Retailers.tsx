import { useState } from 'react'
import { OPENING_SOON, RETAILERS } from '../data'

export function Retailers() {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = RETAILERS.filter((retailer) =>
    [retailer.name, retailer.city, retailer.country].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  )

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
    </>
  )
}
