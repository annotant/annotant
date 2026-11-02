/**
 * The editor a changed file opens in: a URL the browser hands to it, built from
 * `editor` in `.annotant.json`, a known editor's name or a template of its own
 * with `{path}` (the file's absolute path, from a `/`) and `{line}`.
 */
export interface Editor {
  /** What the link says it opens the file in. */
  name: string
  template: string
}

const VSCODE: Editor = { name: 'VS Code', template: 'vscode://file{path}:{line}' }

const KNOWN: Record<string, Editor | undefined> = {
  vscode: VSCODE,
  'vscode-insiders': {
    name: 'VS Code Insiders',
    template: 'vscode-insiders://file{path}:{line}',
  },
  cursor: { name: 'Cursor', template: 'cursor://file{path}:{line}' },
  windsurf: { name: 'Windsurf', template: 'windsurf://file{path}:{line}' },
  zed: { name: 'Zed', template: 'zed://file{path}:{line}' },
}

// A link that would run code in the page, not open an editor.
const UNSAFE = /^\s*(javascript|data|vbscript):/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * The editor `setting` names: VS Code when it names none, none with `false`
 * or a value the widget cannot read.
 */
export function parseEditor(setting: unknown): Editor | undefined {
  if (setting === undefined) return VSCODE
  if (typeof setting !== 'string') return undefined
  const known = Object.hasOwn(KNOWN, setting) ? KNOWN[setting] : undefined
  if (known) return known
  if (!setting.includes('{path}') || UNSAFE.test(setting) || !SCHEME.test(setting))
    return undefined
  return { name: 'your editor', template: setting }
}

/**
 * The link opening `file`, as the hooks named it from the project's `root`, in
 * `editor`, at `line`. Each part of the path encoded, its drive letter kept.
 */
export function editorLink(editor: Editor, root: string, file: string, line = 1) {
  const parts: string[] = []
  for (const part of `${root}/${file}`.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const path = `/${parts
    // Windows' `C:`, which editors read unencoded.
    .map((part, index) =>
      index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part),
    )
    .join('/')}`
  return editor.template.replaceAll('{path}', path).replaceAll('{line}', String(line))
}
