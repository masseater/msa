import { Config, Effect, Option } from "effect";

const optionalEnv = (name: string): string | undefined =>
  Config.String(name).pipe(Config.option, Effect.runSync, Option.getOrUndefined);

const windows = process.platform === "win32";

const environment = {
  optionalEnv,
  windows,
};

export default environment;
