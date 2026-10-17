export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function reportErrorAsync(error: Error): void {
  queueMicrotask(() => {
    throw error;
  });
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
