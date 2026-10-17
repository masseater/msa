import { Config, ConfigProvider, Effect, Option } from "effect";

const envOverrides = new Map<string, string | undefined>();

export const readEnv = (name: string): string | undefined =>
  envOverrides.has(name)
    ? envOverrides.get(name)
    : Effect.runSync(
        Config.option(Config.String(name))
          .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
          .pipe(Effect.map(Option.getOrUndefined)),
      );

export const isEnvSet = (name: string): boolean => (readEnv(name) ?? "") !== "";

export const overrideEnv = (vars: Readonly<Record<string, string | undefined>>): (() => void) => {
  const previous = Object.keys(vars).map(
    (name) => [name, envOverrides.has(name), envOverrides.get(name)] as const,
  );
  for (const [name, value] of Object.entries(vars)) envOverrides.set(name, value);
  return () => {
    for (const [name, wasOverridden, value] of previous.toReversed()) {
      if (wasOverridden) envOverrides.set(name, value);
      else envOverrides.delete(name);
    }
  };
};
