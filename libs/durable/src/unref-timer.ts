import type unrefTimerTypes from "./unref-timer.types.ts";

const startUnrefTimer = (
  run: () => void,
  delayMs: number,
): unrefTimerTypes.UnrefTimer | undefined => {
  if (typeof AbortSignal.timeout !== "function") return undefined;
  const signal = AbortSignal.timeout(delayMs);
  const onAbort = (): void => {
    run();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return {
    cancel: () => {
      signal.removeEventListener("abort", onAbort);
    },
  };
};

const unrefTimer = { startUnrefTimer };

export default unrefTimer;
