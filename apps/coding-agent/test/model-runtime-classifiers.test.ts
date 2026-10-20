import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import ModelRuntime from "../src/core/model-runtime.ts";

const { InMemoryModelsStore } = ai;

const { awaited, runTest } = testing;

const context = {
  questions: {
    approved: {
      criteria: { false: "No approval", true: "Approval" },
      instructions: "Does this express approval?",
      type: "bool" as const,
    },
  },
  state: { text: "Looks good" },
};

const listsJevSeparatelyAndClassifiesWithRuntime = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const runtime = yield* awaited(
        ModelRuntime.create({
          allowModelNetwork: false,
          credentials: AuthStorage.inMemory(),
          modelsPath: null,
          modelsStore: new InMemoryModelsStore(),
        }),
      );
      const jev = runtime.getModelOfType("classifier", "opencode", "jev-1.13")!;
      expect(jev.type).toBe("classifier");
      expect(runtime.getModel("opencode", "jev-1.13")).toBeUndefined();

      const unconfigured = yield* awaited(runtime.classify(jev, context));
      expect(unconfigured.stopReason).toBe("error");
      expect(unconfigured.errorMessage).toContain("not configured");

      yield* awaited(runtime.setRuntimeApiKey("opencode", "sk-opencode"));
      expect(yield* awaited(runtime.getAvailableOfType("classifier", "opencode"))).toContainEqual(
        jev,
      );
      const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
        effectRunPromise(
          Effect.gen(function* () {
            expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-opencode");
            return yield* awaited(
              Response.json({ answers: { approved: { noul: 0.8, type: "noul" } } }),
            );
          }),
        ),
      );
      const result = yield* awaited(runtime.classify(jev, context, { fetch }));
      expect(result.answers["approved"]).toEqual({ probability: 0.8, type: "bool" });
    }),
  );

describe("ModelRuntime classifiers", () => {
  it(
    "lists Jev separately and classifies with runtime-resolved auth",
    listsJevSeparatelyAndClassifiesWithRuntime,
  );
});
