export interface CombinedAbortSignal {
  signal?: AbortSignal;
  cleanup: () => void;
}

export function combineAbortSignals(
  signals: readonly (AbortSignal | undefined)[],
): CombinedAbortSignal {
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  const [first, ...rest] = activeSignals;
  if (first === undefined) {
    return { cleanup: () => {} };
  }
  if (rest.length === 0) {
    return { signal: first, cleanup: () => {} };
  }

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    const listener = () => abort(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}
