declare namespace resultTypes {
  type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError };
}

export type { resultTypes as default };
