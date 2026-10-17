import { Config, ConfigProvider, Effect } from "effect";

export const processEnvConfig = (name: string): Effect.Effect<string | undefined> =>
  Config.String(name)
    .pipe(Config.withDefault(undefined))
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
    .pipe(Effect.orDie);

export const readProcessEnv = (name: string): string | undefined =>
  Effect.runSync(processEnvConfig(name));
