/**
 * The `code` of a Node.js system error (`ENOENT`, `EEXIST`…), if `error` has one.
 * @param {unknown} error
 * @returns {unknown}
 */
export const errorCode = (error) =>
  error instanceof Error && 'code' in error ? error.code : undefined
