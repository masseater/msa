import type abortSignalsTypes from "./abort-signals.types.ts";

function combineAbortSignals(
  signals: readonly (AbortSignal | undefined)[],
): abortSignalsTypes.CombinedAbortSignal {
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  const [first, ...rest] = activeSignals;
  if (first === undefined) {
    return { cleanup: () => {} };
  }
  if (rest.length === 0) {
    return { cleanup: () => {}, signal: first };
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
    listeners.push({ listener, signal });
  }

  return {
    cleanup: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
    signal: controller.signal,
  };
}

const abortSignals = {
  combineAbortSignals,
};

export default abortSignals;
