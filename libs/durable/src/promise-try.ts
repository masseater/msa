/**
 * `Promise.try()`, which Node 22 lacks: `run` starts now, and its throw becomes a rejection, as in an async function.
 * @param {() => T | PromiseLike<T>} run - The work to start.
 * @returns {Promise<T>} A promise of what `run` returns.
 */
export function promiseTry<T>(run: () => T | PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(run());
  });
}
