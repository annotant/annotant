/**
 * The editor a changed file opens in: a URL the browser hands to it, built from
 * `editor` in `.annotant.json`, a known editor's name or a template of its own
 * with `{path}` (the file's absolute path, from a `/`) and `{line}`.
 */
export interface Editor {
  /** What the link says it opens the file in. */
  name: string
  template: string
  /** VS Code when the project named none: the link says how to name another. */
  assumed?: true
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
 * The editor `setting` names: VS Code, `assumed`, when it names none; none
 * with `false` or a value the widget cannot read.
 */
export function parseEditor(setting: unknown): Editor | undefined {
  if (setting === undefined) return { ...VSCODE, assumed: true }
  if (typeof setting !== 'string') return undefined
  const known = Object.hasOwn(KNOWN, setting) ? KNOWN[setting] : undefined
  if (known) return known
  if (!setting.includes('{path}') || UNSAFE.test(setting) || !SCHEME.test(setting))
    return undefined
  return { name: 'your editor', template: setting }
}

// `/home/…`, or Windows' `C:\…`.
const ABSOLUTE = /^([a-z]:)?[\\/]/i
const DRIVE = /^[a-z]:$/i

/**
 * A changed file as the hooks named it: from the project's `root`, `../` out of
 * it, or by its absolute path outside the repository. `name` is what the list
 * shows, `path` where it is (for a relative one, unknown until the server
 * gave `root`), and
 * `external` says it is not in the project.
 */
export function locate(root: string | undefined, file: string) {
  const absolute = ABSOLUTE.test(file)
  const full = absolute ? file : root === undefined ? undefined : `${root}/${file}`
  return {
    name: absolute ? (file.split(/[\\/]/).at(-1) ?? file) : file,
    path: full === undefined ? undefined : normalise(full),
    external: absolute || /^\.\.[\\/]/.test(file),
  }
}

/** `path` with `/` between its parts, `.` and `..` resolved: `/home/…`, `C:/…`. */
function normalise(path: string) {
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return DRIVE.test(parts[0] ?? '') ? parts.join('/') : `/${parts.join('/')}`
}

/**
 * The link opening the file at `path`, absolute, in `editor`, at `line`. Each
 * part of the path encoded, its drive letter kept.
 */
export function editorLink(editor: Editor, path: string, line = 1) {
  const parts = path.split('/').filter(Boolean)
  const encoded = `/${parts
    // Windows' `C:`, which editors read unencoded.
    .map((part, index) =>
      index === 0 && DRIVE.test(part) ? part : encodeURIComponent(part),
    )
    .join('/')}`
  return editor.template.replaceAll('{path}', encoded).replaceAll('{line}', String(line))
}
