import { homedir } from "node:os";

import { Effect, Option, Predicate, Schema } from "effect";

import type { HostShape } from "./host.ts";

const PROVIDER_ENTRY = /\n\t"([^"]+)": \{([\s\S]*?\n\t)\},/gu;
const MODEL_ENTRY = /\n\t\t"([^"]+)": \{[\s\S]*?contextWindow: (\d+),/gu;

interface ContextWindows {
  readonly sources: ReadonlyArray<string>;
  readonly windows: Map<string, number>;
}

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
    const id = model.id;
    return found === undefined || !Predicate.isString(id)
      ? []
      : [[`${provider}/${id}`, found] as const];
  });
  return [...overrides, ...models];
};

const generatedPath = (host: HostShape): string =>
  host.join(process.cwd(), "libs", "ai", "src", "models.generated.ts");

const configPath = (host: HostShape): string =>
  host.join(homedir(), ".msa", "agent", "models.json");

const loadContextWindows = (host: HostShape): Effect.Effect<ContextWindows> =>
  Effect.gen(function* () {
    const windows = new Map<string, number>();
    const sources: Array<string> = [];
    const generated = generatedPath(host);
    if (yield* host.exists(generated)) {
      sources.push(generated);
      for (const [key, value] of generatedWindows(yield* host.readText(generated))) {
        windows.set(key, value);
      }
    }
    const config = configPath(host);
    if (yield* host.exists(config)) {
      const decoded = yield* decodeModelsConfig(yield* host.readText(config)).pipe(Effect.option);
      if (Option.isSome(decoded)) {
        sources.push(config);
        for (const [provider, entry] of Object.entries(decoded.value.providers ?? {})) {
          for (const [key, value] of overrideWindows(provider, entry)) windows.set(key, value);
        }
      }
    }
    return { sources, windows };
  });

export type { ContextWindows };
export { loadContextWindows };
