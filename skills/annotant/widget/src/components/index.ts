import { BUTTON_CSS } from './Button'
import { CHECKBOX_CSS } from './Checkbox'
import { CHIP_CSS } from './Chip'
import { COMPOSER_CSS } from './Composer'
import { ICON_BUTTON_CSS } from './IconButton'
import { MENU_BUTTON_CSS } from './MenuButton'
import { SELECT_CSS } from './Select'
import { SPINNER_CSS } from './Spinner'
import { TEXTAREA_CSS } from './Textarea'
import { TOASTS_CSS } from './Toasts'
import { TOGGLE_CSS } from './Toggle'
import { TOOL_BUTTON_CSS } from './ToolButton'

export { Boundary } from './Boundary'
export { Button } from './Button'
export { Checkbox } from './Checkbox'
export { Chip } from './Chip'
export { Composer } from './Composer'
export { DateTime } from './DateTime'
export { Icon, type IconName } from './Icon'
export { IconButton } from './IconButton'
export { MenuButton } from './MenuButton'
export { Select, type SelectOption } from './Select'
export { Spinner } from './Spinner'
export { Textarea } from './Textarea'
export { Toasts, toast } from './Toasts'
export { Toggle } from './Toggle'
export { ToolButton } from './ToolButton'

/**
 * The shared components' styles, in the widget's stylesheet before the rest:
 * a button's comes before what overrides it (the dock's tools, the composer's
 * buttons, a class a caller adds).
 */
export const COMPONENTS_CSS = [
  BUTTON_CSS,
  ICON_BUTTON_CSS,
  TOOL_BUTTON_CSS,
  MENU_BUTTON_CSS,
  CHIP_CSS,
  TEXTAREA_CSS,
  CHECKBOX_CSS,
  TOGGLE_CSS,
  SELECT_CSS,
  SPINNER_CSS,
  COMPOSER_CSS,
  TOASTS_CSS,
].join('')
