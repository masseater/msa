import { Config, ConfigProvider, Effect } from "effect";

const processEnvConfig = (name: string): Effect.Effect<string | undefined> =>
  Config.String(name)
    .pipe(Config.withDefault(undefined))
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
    .pipe(Effect.orDie);

const readProcessEnv = (name: string): string | undefined => Effect.runSync(processEnvConfig(name));

const env = {
  processEnvConfig,
  readProcessEnv,
};

export default env;
