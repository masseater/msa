import { Effect } from "effect";
import { inject } from "vite-plus/test";

import compat from "../src/compat.ts";

const { getProviders, resolveAuth } = compat;

const resolveLiveAuthProviders: Effect.Effect<readonly string[]> = Effect.map(
  Effect.forEach(
    getProviders(),
    (provider) =>
      Effect.map(
        Effect.promise(() => resolveAuth(provider)),
        (resolved) => (resolved === undefined ? [] : [provider]),
      ),
    { concurrency: "unbounded" },
  ),
  (found) => found.flat(),
);

const hasLiveAuth = (provider: string): boolean => inject("liveAuthProviders").includes(provider);

const liveAuth = { hasLiveAuth, resolveLiveAuthProviders };

export default liveAuth;
