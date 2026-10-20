import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createWebSearchToolDefinition } from "../src/core/tools/web-search.ts";
import webToolsSupport from "./web-tools-support.ts";

const { cli, run, text } = webToolsSupport;

const { abortController, awaited, runTest } = testing;

const searchResult = {
  _treg: { charged_micro: 0, served_by: "tinyfish.web.search", tried: [] },
  output: {
    count: 3,
    results: [
      {
        position: 1,
        snippet: "Effect 4.0 ships a smaller core.",
        title: "Effect 4.0 released",
        url: "https://effect.website/blog/effect-4",
      },
      { link: "https://example.com/untitled" },
      { answer: 42 },
    ],
  },
  raw: {},
};

const runsTregWebSearchThroughTheCli = () =>
  runTest(
    Effect.gen(function* () {
      const runner = cli(searchResult, 200, 0);
      const tool = createWebSearchToolDefinition({ run: runner });

      const result = yield* awaited(run(tool, { limit: 3, query: "effect 4 release" }));

      expect(runner).toHaveBeenCalledWith(
        [
          "--json",
          "call",
          "treg.web.search",
          "--method",
          "POST",
          "--data",
          '{"limit":3,"q":"effect 4 release"}',
          "--header",
          "X-Treg-Route-Prefer: tinyfish",
          "--header",
          "X-Treg-Route-Max-Cost: 0.05",
        ],
        undefined,
      );
      expect(text(result)).toBe(
        [
          "1. Effect 4.0 released\n   https://effect.website/blog/effect-4\n   Effect 4.0 ships a smaller core.",
          "2. https://example.com/untitled\n   https://example.com/untitled",
          '3. {"answer":42}',
        ].join("\n\n"),
      );
      expect(result.details).toEqual({
        costMicro: 0,
        results: [
          { title: "Effect 4.0 released", url: "https://effect.website/blog/effect-4" },
          { title: "https://example.com/untitled", url: "https://example.com/untitled" },
          { title: "(untitled)" },
        ],
        servedBy: "tinyfish.web.search",
      });
    }),
  );

const reportsAMissWhereTregLeavesThe = () =>
  runTest(
    Effect.gen(function* () {
      const tool = createWebSearchToolDefinition({
        run: cli({ _treg: { served_by: null }, output: { results: null }, raw: null }),
      });

      const result = yield* awaited(run(tool, { query: "nothing" }));

      expect(text(result)).toBe("No results found.");
      expect(result.details).toEqual({ results: [] });
    }),
  );

const tellsTheModelHowToSignIn = () =>
  runTest(
    Effect.gen(function* () {
      const tool = createWebSearchToolDefinition({
        run: cli({ detail: "not authenticated" }, 401),
      });

      yield* awaited(
        expect(run(tool, { query: "anything" })).rejects.toThrow(
          "treg returned 401: not authenticated. Sign in with `treg login` or set TREG_TOKEN.",
        ),
      );
    }),
  );

const reportsWhatTheCliSaidWhenIt = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const tool = createWebSearchToolDefinition({
        run: () =>
          effectRunPromise(awaited({ exitCode: 2, stderr: "treg: unknown command", stdout: "" })),
      });

      yield* awaited(
        expect(run(tool, { query: "anything" })).rejects.toThrow(
          "treg exited 2 without a result: treg: unknown command",
        ),
      );
    }),
  );

const passesTheAbortSignalToTheCli = () =>
  runTest(
    Effect.gen(function* () {
      const runner = cli(searchResult);
      const controller = abortController();

      yield* awaited(
        run(createWebSearchToolDefinition({ run: runner }), { query: "q" }, controller.signal),
      );

      expect(runner.mock.calls[0]![1]).toBe(controller.signal);
    }),
  );

describe("web_search tool", () => {
  it(
    "runs treg.web.search through the CLI, free vendor first, with a cost cap",
    runsTregWebSearchThroughTheCli,
  );

  it("reports a miss, where treg leaves the results null", reportsAMissWhereTregLeavesThe);

  it("tells the model how to sign in when treg refuses the call", tellsTheModelHowToSignIn);

  it("reports what the CLI said when it printed no result", reportsWhatTheCliSaidWhenIt);

  it("passes the abort signal to the CLI", passesTheAbortSignalToTheCli);
});
