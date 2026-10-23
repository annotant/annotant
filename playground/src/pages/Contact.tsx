import { useRef, useState, type FormEvent } from 'react'

export function Contact() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('name')
    setName(typeof value === 'string' ? value : '')
    event.currentTarget.reset()
    dialog.current?.showModal()
  }

  return (
    <>
      <section className="section">
        <h1>Contact us</h1>
        <p className="lead">
          A question about an order, a wholesale account or brewing? We answer within a
          day.
        </p>
      </section>

      <form className="form card" onSubmit={onSubmit}>
        <label className="field">
          <span>Name</span>
          <input name="name" autoComplete="name" required />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          <span>Topic</span>
          <select name="topic" defaultValue="order">
            <option value="order">An order</option>
            <option value="wholesale">Wholesale</option>
            <option value="brewing">Brewing advice</option>
          </select>
        </label>
        <label className="field">
          <span>Message</span>
          <textarea name="message" rows={5} required />
        </label>
        <label className="checkbox">
          <input name="newsletter" type="checkbox" />
          Send me the monthly roast notes
        </label>
        <div className="actions">
          <button type="submit" className="btn">
            Send
          </button>
        </div>
      </form>

      <dialog ref={dialog} className="dialog" aria-labelledby="sent-title">
        <h2 id="sent-title">Thanks{name ? `, ${name}` : ''}!</h2>
        <p>Your message is on its way. Nothing was actually sent: this shop is fake.</p>
        <form method="dialog" className="actions">
          <button type="submit" className="btn">
            Close
          </button>
        </form>
      </dialog>
    </>
  )
}
