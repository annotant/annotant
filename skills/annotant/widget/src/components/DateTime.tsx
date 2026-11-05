import { dateFormat, relativeDate } from '../dates'

// Built on the first date shown, then kept for the page's life.
let dates: Intl.DateTimeFormat | undefined

/** A date in the reader's languages: in full, or relative to `now`. */
export function DateTime({
  at,
  now,
  className,
}: {
  /** A date `Date` reads (the comments file holds ISO dates); one it cannot shows as it is. */
  at: string
  /** Given, the date shows relative to it, the full one in the tooltip. */
  now?: number
  className?: string
}) {
  const date = new Date(at)
  // `format` throws on an invalid date: a hand-edited comments file shows it as is.
  if (Number.isNaN(date.getTime())) {
    return (
      <time className={className} dateTime={at}>
        {at}
      </time>
    )
  }
  const full = (dates ??= dateFormat()).format(date)
  return now === undefined ? (
    <time className={className} dateTime={at}>
      {full}
    </time>
  ) : (
    <time className={className} dateTime={at} title={full}>
      {relativeDate(date, now)}
    </time>
  )
}
