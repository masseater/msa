import type resultTypes from "./result.types.ts";

function ok<TValue, TError>(value: TValue): resultTypes.Result<TValue, TError> {
  return { ok: true, value };
}

function err<TValue, TError>(error: TError): resultTypes.Result<TValue, TError> {
  return { error, ok: false };
}

function getOrThrow<TValue, TError>(result: resultTypes.Result<TValue, TError>): TValue {
  if (!result.ok) throw result.error;
  return result.value;
}

function getOrUndefined<TValue extends object, TError>(
  result: resultTypes.Result<TValue, TError>,
): TValue | undefined {
  return result.ok ? result.value : undefined;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

const resultModule = {
  err,
  getOrThrow,
  getOrUndefined,
  ok,
  toError,
};

export default resultModule;
