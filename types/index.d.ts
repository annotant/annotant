// The values Code Buddy's hooks module keeps in $.state for the session.

/**
 * What the hooks read of the comments file: a narrowed view of lib/format.mjs's
 * CommentsFile, the format's reference: what the classifier reads, and who
 * moved a comment last.
 */
export type CommentsFile = {
  version: number
  comments: {
    id: string
    state: string
    route?: string
    anchor?: { quote?: string; element?: { tag?: string; text?: string } }
    messages?: {
      author: string
      body: string
      images?: string[]
      elements?: { tag?: string; text?: string }[]
    }[]
    events?: { by: string }[]
  }[]
}

/** lib/format.mjs's Complexity: how the classifier sorts a comment. */
export type Complexity = 'trivial' | 'standard' | 'hard'

/**
 * The agent the hooks started for a comment, the project root and the model
 * it runs on: a follow-up or an edit goes to it, a stop ends it. `running`
 * until its turn completes; a message resumes it.
 */
export type Worker = {
  agent: string
  root: string
  running: boolean
  model?: string
  /** The effort its agent type was registered with, when routing set one. */
  effort?: string
}

declare module 'claude-code' {
  interface McpToolInputs {
    /** The skill's way in: the project root, absolute. */
    'mcp__code-buddy__watch': { project?: string; stop?: boolean }
  }
  interface PluginState {
    'code-buddy': {
      /** By comment id. */
      workers: Record<string, Worker>
      /**
       * The projects `/code-buddy` watches, by root: their servers die with the
       * module, and a reload starts them again.
       */
      watching: Record<string, true>
    }
  }
}
