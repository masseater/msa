import { Config, ConfigProvider, Effect, Option } from "effect";

export const readEnv = (name: string): string | undefined =>
  Effect.runSync(
    Config.option(Config.String(name))
      .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
      .pipe(Effect.map(Option.getOrUndefined)),
  );

export const isEnvSet = (name: string): boolean => (readEnv(name) ?? "") !== "";
