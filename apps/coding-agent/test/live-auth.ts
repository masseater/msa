import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";

import ModelRuntime from "../src/core/model-runtime.ts";
import platform from "../src/core/platform/index.ts";

const { InMemoryCredentialStore } = ai;

const { withEnv } = platform;

const { awaited } = testing;

const LIVE_PROVIDER = "anthropic-api" as const;

const liveAuthAvailable: Effect.Effect<boolean> = Effect.gen(function* () {
  const runtime = yield* awaited(
    ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null }),
  );
  return (yield* awaited(runtime.getAuth(LIVE_PROVIDER))) !== undefined;
}).pipe(withEnv({ MSA_OFFLINE: "1" }));

const liveAuth = { LIVE_PROVIDER, liveAuthAvailable };

export default liveAuth;
