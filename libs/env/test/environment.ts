import { Config, Effect, Option } from "effect";

const optionalEnv = (name: string): string | undefined =>
  Option.getOrUndefined(Effect.runSync(Config.option(Config.String(name))));

const windows = process.platform === "win32";

const environment = {
  optionalEnv,
  windows,
};

export default environment;
