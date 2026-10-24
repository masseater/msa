import { Effect } from "effect";
import type { TestProject } from "vite-plus/test/node";

import resolveApiKey from "../../ai/test/oauth.ts";
import storedProviders from "../../ai/test/stored-providers.ts";

const { STORED_PROVIDERS } = storedProviders;

declare module "vitest" {
  interface ProvidedContext {
    readonly storedApiKeys: Readonly<Record<string, string>>;
  }
}

const setup = (project: TestProject): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const entries = yield* Effect.forEach(
        STORED_PROVIDERS,
        (provider) =>
          Effect.map(
            Effect.promise(() => resolveApiKey(provider)),
            (key) => [provider, key ?? ""] as const,
          ),
        { concurrency: "unbounded" },
      );
      project.provide("storedApiKeys", Object.fromEntries(entries));
    }),
  );

export default setup;
