declare namespace abortSignalsTypes {
  interface CombinedAbortSignal {
    signal?: AbortSignal;
    cleanup: () => void;
  }
}

export type { abortSignalsTypes as default };
