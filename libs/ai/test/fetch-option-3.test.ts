import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { streamSimple as streamGoogleGenerativeAI } from "../src/api/google-generative-ai.ts";
import type { FetchFunction } from "../src/types.ts";
import fetchOptionSupport from "./fetch-option-support.ts";

const { context, createModel } = fetchOptionSupport;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetch stream option", () => {
  it("allows the Google adapter to receive globalThis.fetch explicitly", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ambient = vi.fn<FetchFunction>(() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: { message: "upstream rejected request" } }), {
              headers: { "content-type": "application/json" },
              status: 401,
            }),
          ),
        );
        vi.stubGlobal("fetch", ambient);
        const result = yield* Effect.promise(() =>
          streamGoogleGenerativeAI(createModel("google-generative-ai"), context, {
            apiKey: "test-key",
            fetch: ambient,
          }).result(),
        );

        expect(ambient).toHaveBeenCalledOnce();
        expect(result.errorMessage).not.toContain("Custom fetch is not supported");
        expect(globalThis.fetch).toBe(ambient);
      }),
    ));
});
