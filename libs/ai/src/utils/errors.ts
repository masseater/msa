/**
 * The message of a thrown value, which need not be an `Error`.
 *
 * @param {unknown} error - thrown value
 * @returns {string} the message
 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
