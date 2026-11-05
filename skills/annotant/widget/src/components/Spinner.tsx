/** A turning ring, in the text's colour: something is under way. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="an-spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity=".2"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const SPINNER_CSS = `
.an-spinner { animation: an-spin .8s linear infinite; flex-shrink: 0; }
@keyframes an-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .an-spinner { animation: none; } }
`
