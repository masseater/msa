import { Effect } from "effect";
import type { TestProject } from "vite-plus/test/node";

import localLlmSupport from "./local-llm-support.ts";
import resolveApiKey from "./oauth.ts";

declare module "vitest" {
  interface ProvidedContext {
    readonly localLlms: {
      readonly llamaCpp: boolean;
      readonly lmStudio: boolean;
      readonly ollama: boolean;
    };
    readonly storedApiKeys: Readonly<Record<string, string>>;
  }
}

const STORED_PROVIDERS = ["anthropic", "openai-codex"];

const resolveAll = Effect.forEach(
  STORED_PROVIDERS,
  (provider) =>
    Effect.map(
      Effect.promise(() => resolveApiKey(provider)),
      (key) => [provider, key ?? ""] as const,
    ),
  { concurrency: "unbounded" },
);

const setup = (project: TestProject): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const entries = yield* resolveAll;
      project.provide("storedApiKeys", Object.fromEntries(entries));
      project.provide("localLlms", yield* Effect.promise(() => localLlmSupport.probeLocalLlms()));
    }),
  );

export default setup;
