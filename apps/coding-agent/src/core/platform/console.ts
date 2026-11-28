import { Console, Effect } from "effect";

const writeVia =
  (log: (...args: ReadonlyArray<any>) => Effect.Effect<void>) =>
  (...args: readonly unknown[]): void => {
    Effect.runSync(log(...args));
  };

const writeLog = writeVia(Console.log);

const writeWarn = writeVia(Console.warn);

const writeError = writeVia(Console.error);

const platformConsole = {
  writeError,
  writeLog,
  writeWarn,
};

export default platformConsole;
