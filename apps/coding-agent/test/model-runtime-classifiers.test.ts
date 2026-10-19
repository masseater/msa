import { InMemoryModelsStore } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const context = {
  state: { text: "Looks good" },
  questions: {
    approved: {
      type: "bool" as const,
      instructions: "Does this express approval?",
      criteria: { true: "Approval", false: "No approval" },
    },
  },
};

describe("ModelRuntime classifiers", () => {
  it("lists Jev separately and classifies with runtime-resolved auth", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsStore: new InMemoryModelsStore(),
            modelsPath: null,
            allowModelNetwork: false,
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
                Response.json({ answers: { approved: { type: "noul", noul: 0.8 } } }),
              );
            }),
          ),
        );
        const result = yield* awaited(runtime.classify(jev, context, { fetch }));
        expect(result.answers["approved"]).toEqual({ type: "bool", probability: 0.8 });
      }),
    ));
});
