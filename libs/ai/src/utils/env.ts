import { Config, ConfigProvider, Effect } from "effect";

const liveValues = ConfigProvider.fromEnv({
  env: process.env as Record<string, string>,
  preserveEmptyStrings: true,
});

const processEnvConfig = (name: string): Effect.Effect<string | undefined> =>
  Config.String(name).pipe(Config.withDefault(undefined)).parse(liveValues).pipe(Effect.orDie);

const readProcessEnv = (name: string): string | undefined => Effect.runSync(processEnvConfig(name));

const env = {
  processEnvConfig,
  readProcessEnv,
};

export default env;
