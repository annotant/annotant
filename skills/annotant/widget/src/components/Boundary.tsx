import { type ReactNode, Component } from 'react'

/**
 * Draws `children()`, or `fallback` once that throws: one comment the widget
 * cannot draw never takes the whole widget down. It tries again when
 * `resetOn` changes, as when the server sends that comment anew.
 */
export class Boundary extends Component<
  { fallback: ReactNode; resetOn?: unknown; children: () => ReactNode },
  { failed: boolean; resetOn?: unknown }
> {
  override state = { failed: false, resetOn: this.props.resetOn }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(
    props: { resetOn?: unknown },
    state: { resetOn?: unknown },
  ) {
    return props.resetOn === state.resetOn
      ? null
      : { failed: false, resetOn: props.resetOn }
  }

  override render() {
    return this.state.failed ? this.props.fallback : <Draw render={this.props.children} />
  }
}

/** Calls `render` in a component of its own, for the boundary above to catch what it throws. */
function Draw({ render }: { render: () => ReactNode }) {
  return render()
}
