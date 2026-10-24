import { Effect } from "effect";
import type { TestProject } from "vite-plus/test/node";

import liveAuth from "./live-auth.ts";
import localLlmSupport from "./local-llm-support.ts";
import resolveApiKey from "./oauth.ts";
import storedProviders from "./stored-providers.ts";

const { STORED_PROVIDERS } = storedProviders;

const { resolveLiveAuthProviders } = liveAuth;

declare module "vitest" {
  interface ProvidedContext {
    readonly localLlms: {
      readonly llamaCpp: boolean;
      readonly lmStudio: boolean;
      readonly ollama: boolean;
    };
    readonly liveAuthProviders: readonly string[];
    readonly storedApiKeys: Readonly<Record<string, string>>;
  }
}

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
      project.provide("liveAuthProviders", yield* resolveLiveAuthProviders);
      project.provide("localLlms", yield* Effect.promise(() => localLlmSupport.probeLocalLlms()));
    }),
  );

export default setup;
