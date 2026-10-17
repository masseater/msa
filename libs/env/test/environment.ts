import { Config, Effect, Option } from "effect";

export const optionalEnv = (name: string): string | undefined =>
  Option.getOrUndefined(Effect.runSync(Config.option(Config.String(name))));

export const windows = process.platform === "win32";
