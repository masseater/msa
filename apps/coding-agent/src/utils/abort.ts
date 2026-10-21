import { dual } from "effect/Function";

import interop from "./interop.ts";

const { callbackPromise } = interop;
function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function operationSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? new AbortController().signal;
}

function raceWithAbortSignalImpl<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) {
    void operation.catch(() => {});
    return Promise.reject(abortReason(signal));
  }

  return callbackPromise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        if (settled) return undefined;
        settled = true;
        cleanup();
        resolve(value);
        return undefined;
      },
      (error: unknown) => {
        if (settled) return undefined;
        settled = true;
        cleanup();
        reject(error);
        return undefined;
      },
    );
    if (signal.aborted) onAbort();
  });
}

const raceWithAbortSignal: {
  <T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T>;
  <T>(signal: AbortSignal | undefined): (operation: Promise<T>) => Promise<T>;
} = dual((args: IArguments) => args.length >= 2, raceWithAbortSignalImpl);

const abort = {
  operationSignal,
  raceWithAbortSignal,
};

export default abort;
