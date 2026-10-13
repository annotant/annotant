// The values Code Buddy's hooks module keeps in $.state for the session.

/** The comment an agent claimed, and the project it belongs to. */
export type Binding = {
  root: string
  comment: string
  /** The run claim.mjs started (`r1`, `r2`…), which tags the agent's steps. */
  run?: string
  /** The folder of the claim.mjs the agent ran, when its command named it. */
  scripts?: string
}

/**
 * What the hooks read of the comments file: a narrowed view of lib/format.mjs's
 * CommentsFile, the format's reference, for which comments an agent may work on.
 */
export type CommentsFile = {
  version: number
  comments: {
    id: string
    state: string
    route?: string
    anchor?: { quote?: string; element?: { tag?: string; text?: string } }
    messages?: { author: string; body: string }[]
  }[]
}

/** lib/format.mjs's Complexity: how the classifier sorts a comment. */
export type Complexity = 'trivial' | 'standard' | 'hard'

/**
 * The model a comment's agent was started on, as Claude Code resolved it, and
 * the classifier's label when it ran; claim.mjs records both on the run.
 */
export type Route = {
  model: string
  complexity?: Complexity
  /** The agent started for the comment: only its claims carry the route. */
  agent?: string
}

/** A file lock: the comment whose agent holds it, and since when. */
export type Lock = { owner: string; at: number }

/**
 * The agent the hooks started for a comment: a follow-up or an edit goes to
 * it, a stop ends it. `running` until its turn completes; a message resumes it.
 */
export type Worker = { agent: string; root: string; running: boolean }

declare module 'claude-code' {
  interface McpToolInputs {
    /** The skill's way in: the project root, absolute. */
    'mcp__code-buddy__watch': { project: string }
  }
  interface PluginState {
    'code-buddy': {
      /** By agent id (`main` for the main loop). */
      bindings: Record<string, Binding>
      /** By `<project root>\n<path relative to it, or @build>`. */
      locks: Record<string, Lock>
      /** By comment id: kept for a follow-up, which resumes the same agent. */
      routes: Record<string, Route>
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
