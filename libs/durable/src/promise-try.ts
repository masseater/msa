export function promiseTry<T>(run: () => T | PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(run());
  });
}
