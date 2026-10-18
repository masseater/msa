import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";

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

export const nowIso = (): string => DateTime.now.pipe(Effect.runSync, DateTime.formatIso);

export const toEpochMs = (value: string | number): number =>
  Option.match(DateTime.make(value), { onNone: () => Number.NaN, onSome: DateTime.toEpochMillis });

export const toDate = (value: string | number): Date =>
  DateTime.toDate(Option.getOrElse(DateTime.make(value), () => DateTime.makeUnsafe(0)));

export const readEnv = (name: string): string | undefined =>
  Effect.runSync(
    Config.String(name)
      .pipe(Config.withDefault(undefined))
      .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
      .pipe(Effect.orDie),
  );

export const randomUnit = (): number => Effect.runSync(Random.next);
