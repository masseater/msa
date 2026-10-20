import type { ToolExecutionApi } from "@msa/durable";
import type { ExecutionEnv } from "@msa/durable/env";
import { createBashTool, createReadTool } from "@msa/durable/tools";
import { Effect, Schema } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import differentialSupport from "./differential-support.ts";
import randomOperation from "./random-operation.ts";

const { context, normalize, pairs, random } = differentialSupport;

const environments = pairs();
afterAll(environments.close);

const randomSequences = Effect.gen(function* () {
  for (let seed = 1; seed <= 60; seed++) {
    const next = random(seed);
    const { local, remote, roots } = yield* environments.pair;
    for (let step = 0; step < 25; step++) {
      const operation = randomOperation(next);
      const expected = normalize(yield* Effect.promise(() => operation.run(local)), roots[0]);
      const actual = normalize(yield* Effect.promise(() => operation.run(remote)), roots[1]);
      expect(actual, `seed ${seed} step ${step} ${operation.label}`).toEqual(expected);
    }
  }
});

const toJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

type Tool = ReturnType<typeof createReadTool> | ReturnType<typeof createBashTool>;

const FILES: [string, string | Uint8Array][] = [
  ["text.txt", "one\ntwo\n\nthree"],
  ["big.txt", "line\n".repeat(3000)],
  ["long.txt", `${"é".repeat(40_000)}\nend`],
  ["bom.txt", "\ufeffhello"],
  ["bad.txt", Uint8Array.from([0x61, 0xe2, 0x82, 0x0a, 0x62])],
];

const toolCases = (): [Tool, object][] => [
  [createReadTool(), { path: "text.txt" }],
  [createReadTool(), { limit: 1, offset: 2, path: "text.txt" }],
  [createReadTool(), { path: "big.txt" }],
  [createReadTool(), { path: "long.txt" }],
  [createReadTool(), { path: "bom.txt" }],
  [createReadTool(), { path: "bad.txt" }],
  [createReadTool(), { path: "missing.txt" }],
  [createBashTool(), { command: "cat text.txt; exit 0" }],
  [createBashTool(), { command: "echo err >&2; exit 0" }],
  [createBashTool(), { command: "exit 3" }],
  [createBashTool(), { command: "printf 'a\\nb'; ls" }],
];

const api = (env: ExecutionEnv, output: string[]): ToolExecutionApi =>
  ({
    details: () => Promise.resolve(),
    diagnostic: () => undefined,
    env,
    output: (chunk: string | Uint8Array) => output.push(String(chunk)),
    outputWindow: undefined,
    retainedOutput: () => ({ text: output.join(""), truncated: false }),
  }) as unknown as ToolExecutionApi;

interface ToolRun {
  readonly env: ExecutionEnv;
  readonly tool: Tool;
  readonly args: object;
}

const runTool = ({ env, tool, args }: ToolRun): Effect.Effect<unknown> => {
  const output: string[] = [];
  return Effect.tryPromise(() => tool.execute(args as never, api(env, output), context)).pipe(
    Effect.map((result) => ({ output: output.join(""), result })),
    Effect.catch((failure) =>
      Effect.succeed({ error: (failure.cause as Error).message, output: output.join("") }),
    ),
  );
};

const toolResults = Effect.gen(function* () {
  const { local, remote, roots } = yield* environments.pair;
  for (const [path, content] of FILES) {
    yield* Effect.promise(() => local.writeFile(path, content, context));
    yield* Effect.promise(() => remote.writeFile(path, content, context));
  }
  for (const [tool, args] of toolCases()) {
    const expected = normalize(yield* runTool({ args, env: local, tool }), roots[0]);
    const actual = normalize(yield* runTool({ args, env: remote, tool }), roots[1]);
    expect(actual, yield* toJson(args)).toEqual(expected);
  }
});

describe("RemoteExecutionEnv against NodeExecutionEnv", () => {
  it(
    "gives the same results for random file operation sequences",
    () => Effect.runPromise(randomSequences),
    120_000,
  );
  it("gives the same read and bash tool results", () => Effect.runPromise(toolResults), 60_000);
});
