import { Console, Effect } from "effect";

const writeLog = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.log(...args));
};

const writeWarn = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.warn(...args));
};

const writeError = (...args: readonly unknown[]): void => {
  Effect.runSync(Console.error(...args));
};

const platformConsole = {
  writeError,
  writeLog,
  writeWarn,
};

export default platformConsole;
