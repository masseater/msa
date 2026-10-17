import { Config, ConfigProvider, Effect } from "effect";

export const readEnv = (name: string) =>
  Config.String(name)
    .pipe(Config.withDefault(undefined))
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }));

export const envValue = (name: string): string | undefined => Effect.runSync(readEnv(name));

const isPresent = (value: string | undefined): boolean => value !== undefined && value !== "";

export const hasEnv = (name: string): boolean => isPresent(envValue(name));

export const hasValue = isPresent;
