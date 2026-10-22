/**
 * Sets one of `element`'s inline style properties, which the host page may have set too. The
 * returned function puts back the host's value, with its priority, unless the property no longer
 * holds `value`: what the host wrote meanwhile stays.
 */
export function setInlineStyle(
  element: HTMLElement,
  property: string,
  value: string,
): () => void {
  const { style } = element
  const before = style.getPropertyValue(property)
  const priority = style.getPropertyPriority(property)
  style.setProperty(property, value)
  return () => {
    if (style.getPropertyValue(property) !== value) return
    if (before) style.setProperty(property, before, priority)
    else style.removeProperty(property)
  }
}
