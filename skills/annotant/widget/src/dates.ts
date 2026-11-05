/**
 * The date and time (or what `options` asks for) in the reader's preferred
 * languages (`navigator.languages`), not the browser's interface one: `Intl`
 * takes the first it supports. An empty list, or one `Intl` rejects (a tag the
 * page made up), → the default locale.
 */
export function dateFormat(
  languages: readonly string[] | undefined = navigator.languages,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
) {
  try {
    return new Intl.DateTimeFormat(languages?.length ? languages : undefined, options)
  } catch {
    return new Intl.DateTimeFormat(undefined, options)
  }
}

/** Like `dateFormat`, for how long ago: _5 min ago_, _yesterday_. */
function relativeFormat(languages: readonly string[] | undefined) {
  const options: Intl.RelativeTimeFormatOptions = { numeric: 'auto', style: 'short' }
  try {
    return new Intl.RelativeTimeFormat(languages?.length ? languages : undefined, options)
  } catch {
    return new Intl.RelativeTimeFormat(undefined, options)
  }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long before `now` `date` is, in the reader's languages: _now_ under a
 * minute (or ahead of `now`: another clock), then minutes, hours, and whole
 * 24-hour days (_yesterday_, _2 days ago_); from a week on, the short date
 * alone, without the time.
 */
export function relativeDate(
  date: Date,
  now: number,
  languages: readonly string[] | undefined = navigator.languages,
) {
  const ago = Math.max(0, now - date.getTime())
  if (ago >= 7 * DAY) return dateFormat(languages, { dateStyle: 'short' }).format(date)
  const relative = relativeFormat(languages)
  if (ago < MINUTE) return relative.format(0, 'second')
  if (ago < HOUR) return relative.format(-Math.floor(ago / MINUTE), 'minute')
  if (ago < DAY) return relative.format(-Math.floor(ago / HOUR), 'hour')
  return relative.format(-Math.floor(ago / DAY), 'day')
}
