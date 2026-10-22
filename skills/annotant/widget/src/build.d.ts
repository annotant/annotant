// Provided by build.mjs.

declare module '*.webp' {
  /** A data URL: the build inlines images. */
  const src: string
  export default src
}

declare module '*.woff2' {
  /** A data URL: the build inlines fonts. */
  const src: string
  export default src
}

/** The plugin's version, read from .claude-plugin/plugin.json at build time. */
declare const ANNOTANT_VERSION: string

/** True in a dev build (`npm run build:dev`), which has the debug panel; false in a release. */
declare const ANNOTANT_DEBUG: boolean
