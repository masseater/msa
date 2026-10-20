import { Config, ConfigProvider, Effect } from "effect";

const readEnv = (name: string) =>
  Config.String(name)
    .pipe(Config.withDefault(undefined))
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }));

const envValue = (name: string): string | undefined => Effect.runSync(readEnv(name));

const isPresent = (value: string | undefined): boolean => value !== undefined && value !== "";

const hasEnv = (name: string): boolean => isPresent(envValue(name));

const hasValue = isPresent;

const env = {
  envValue,
  hasEnv,
  hasValue,
  readEnv,
};

export default env;
