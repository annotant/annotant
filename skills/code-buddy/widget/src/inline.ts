/**
 * Saves one of `element`'s inline style properties before the widget changes it: the host page
 * may have set it too. The returned function puts back that value, with its priority.
 */
export function saveInlineStyle(element: HTMLElement, property: string): () => void {
  const { style } = element
  const value = style.getPropertyValue(property)
  const priority = style.getPropertyPriority(property)
  return () => {
    if (value) style.setProperty(property, value, priority)
    else style.removeProperty(property)
  }
}
