export type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError };

export function ok<TValue, TError>(value: TValue): Result<TValue, TError> {
  return { ok: true, value };
}

export function err<TValue, TError>(error: TError): Result<TValue, TError> {
  return { ok: false, error };
}

export function getOrThrow<TValue, TError>(result: Result<TValue, TError>): TValue {
  if (!result.ok) throw result.error;
  return result.value;
}

export function getOrUndefined<TValue extends object, TError>(
  result: Result<TValue, TError>,
): TValue | undefined {
  return result.ok ? result.value : undefined;
}

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}
