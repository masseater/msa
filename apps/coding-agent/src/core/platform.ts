import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

export const nowMs = (): number => Effect.runSync(Clock.currentTimeMillis);

export const writeLog = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.log(...args));
};

export const writeWarn = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.warn(...args));
};

export const writeError = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.error(...args));
};
