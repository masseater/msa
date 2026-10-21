import { homedir } from "node:os";

import { Effect, Option, Predicate, Schema } from "effect";

import type hostTypes from "./host.types.ts";
import type sessionContextWindowsTypes from "./session-context-windows.types.ts";

const PROVIDER_ENTRY = /\n\t"([^"]+)": \{([\s\S]*?\n\t)\},/gu;
const MODEL_ENTRY = /\n\t\t"([^"]+)": \{[\s\S]*?contextWindow: (\d+),/gu;

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

const ProviderConfig = Schema.Struct({
  modelOverrides: Schema.optional(UnknownRecord),
  models: Schema.optional(Schema.Array(UnknownRecord)),
});

const decodeModelsConfig = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      providers: Schema.optional(Schema.Record(Schema.String, ProviderConfig)),
    }),
  ),
);

const contextWindowOf = (value: unknown): number | undefined => {
  if (!Predicate.hasProperty("contextWindow")(value)) return undefined;
  const found = value.contextWindow;
  return Predicate.isNumber(found) ? found : undefined;
};

const generatedWindows = (text: string): ReadonlyArray<readonly [string, number]> =>
  [...text.matchAll(PROVIDER_ENTRY)].flatMap((provider) =>
    [...(provider[2] ?? "").matchAll(MODEL_ENTRY)].map(
      (model) => [`${provider[1]}/${model[1]}`, Number(model[2])] as const,
    ),
  );

const overrideWindows = (
  provider: string,
  config: typeof ProviderConfig.Type,
): ReadonlyArray<readonly [string, number]> => {
  const overrides = Object.entries(config.modelOverrides ?? {}).flatMap(([modelId, override]) => {
    const found = contextWindowOf(override);
    return found === undefined ? [] : [[`${provider}/${modelId}`, found] as const];
  });
  const models = (config.models ?? []).flatMap((model) => {
    const found = contextWindowOf(model);
    const id = model["id"];
    return found === undefined || !Predicate.isString(id)
      ? []
      : [[`${provider}/${id}`, found] as const];
  });
  return [...overrides, ...models];
};

const generatedPath = (host: hostTypes.HostShape): string =>
  host.join(process.cwd(), "libs", "ai", "src", "models.generated.ts");

const configPath = (host: hostTypes.HostShape): string =>
  host.join(homedir(), ".msa", "agent", "models.json");

interface WindowSource {
  readonly entries: ReadonlyArray<readonly [string, number]>;
  readonly source: string;
}

const readGeneratedWindows = (host: hostTypes.HostShape): Effect.Effect<WindowSource | null> =>
  Effect.gen(function* () {
    const generated = generatedPath(host);
    if (!(yield* host.exists(generated))) return null;
    return { entries: generatedWindows(yield* host.readText(generated)), source: generated };
  });

const configuredWindows = (
  providers: Readonly<Record<string, typeof ProviderConfig.Type>> | undefined,
): ReadonlyArray<readonly [string, number]> =>
  Object.entries(providers ?? {}).flatMap(([provider, entry]) => overrideWindows(provider, entry));

const readConfigWindows = (host: hostTypes.HostShape): Effect.Effect<WindowSource | null> =>
  Effect.gen(function* () {
    const config = configPath(host);
    if (!(yield* host.exists(config))) return null;
    const decoded = yield* decodeModelsConfig(yield* host.readText(config)).pipe(Effect.option);
    return Option.isSome(decoded)
      ? { entries: configuredWindows(decoded.value.providers), source: config }
      : null;
  });

const loadContextWindows = (
  host: hostTypes.HostShape,
): Effect.Effect<sessionContextWindowsTypes.ContextWindows> =>
  Effect.gen(function* () {
    const found = [yield* readGeneratedWindows(host), yield* readConfigWindows(host)].filter(
      Predicate.isNotNull,
    );
    return {
      sources: found.map((window) => window.source),
      windows: new Map(found.flatMap((window) => window.entries)),
    };
  });

const sessionContextWindows = {
  loadContextWindows,
};

export default sessionContextWindows;
