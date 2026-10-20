import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import modelsGenerated from "../src/models.generated.ts";
import type typesModule from "../src/types.types.ts";
import env from "./env.ts";

const { MODELS } = modelsGenerated;
const { complete } = compat;

const { envValue } = env;

describe.skipIf(envValue("OPENCODE_API_KEY") === undefined || envValue("OPENCODE_API_KEY") === "")(
  "OpenCode Models Smoke Test",
  () => {
    const providers = [
      { key: "opencode", label: "OpenCode Zen" },
      { key: "opencode-go", label: "OpenCode Go" },
    ] as const;

    providers.forEach(({ key, label }) => {
      const providerModels = Object.values(MODELS[key]);
      providerModels.forEach((model) => {
        it(
          `${label}: ${model.id}`,
          () =>
            Effect.runPromise(
              Effect.gen(function* () {
                const currentTime = yield* Clock.currentTimeMillis;
                const response = yield* Effect.promise(() =>
                  complete(model as typesModule.Model<any>, {
                    messages: [{ content: "Say hello.", role: "user", timestamp: currentTime }],
                  }),
                );

                expect(response.content).toBeTruthy();
                expect(response.stopReason).toBe("stop");
              }),
            ),
          60000,
        );
      });
    });
  },
);
