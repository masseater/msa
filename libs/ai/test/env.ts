import { Config, ConfigProvider, Effect } from "effect";

export const readEnv = (name: string) =>
  Config.String(name)
    .pipe(Config.withDefault(undefined))
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }));

export const envValue = (name: string): string | undefined => Effect.runSync(readEnv(name));
