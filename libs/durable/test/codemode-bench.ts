import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import ai from "@msa/ai";
import codemodeModule from "@msa/codemode";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import { Console, Effect } from "effect";
import { Type } from "typebox";

import codemode from "../src/codemode/codemode.ts";
import node from "../src/storage/sqlite/node.ts";
import support from "./support.ts";

const { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } = ai;

const { CodemodeSandbox } = codemodeModule;

const { defineExtension, defineTool } = durable;
const { Harness, createRegistry } = harnessModule;
const { createCodemodeTool } = codemode;
const { openNodeSqliteStorage } = node;

const { BACKGROUND_CONTEXT: context, awaited, joinPath, makeTempDir, removeDir } = support;

type Shape = "sequential" | "parallel";

const echo = defineTool({
  description: "echo",
  execute: (args) => Promise.resolve({ output: [{ text: String(args.i), type: "text" }] }),
  name: "echo",
  parameters: Type.Object({ i: Type.Number() }),
});

const plain = defineTool({
  description: "plain",
  execute: (args, api, callContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (args.shape === "sequential") {
          for (const i of Array.from({ length: args.n }, (_, iInner) => iInner))
            yield* awaited(api.executeTool("echo", { i }, callContext));
        } else {
          yield* awaited(
            Promise.all(
              Array.from({ length: args.n }, (_, i) => api.executeTool("echo", { i }, callContext)),
            ),
          );
        }
        return { output: [{ text: "done", type: "text" }] };
      }),
    ),
  name: "plain",
  parameters: Type.Object({ n: Type.Number(), shape: Type.String() }),
  replay: "safe",
});

const run = Effect.fn("run")(function* (mode: "codemode" | "plain", shape: Shape, n: number) {
  const directory = yield* makeTempDir("msa-codemode-bench-");
  return yield* Effect.gen(function* () {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const sandbox = new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 });
    const registry = createRegistry();
    registry.install(
      defineExtension({ name: "bench", tools: [echo, plain, createCodemodeTool({ sandbox })] }),
    );
    const code =
      shape === "sequential"
        ? `for (let i = 0; i < ${n}; i++) await tools.echo({ i }); return "done";`
        : `await Promise.all(Array.from({ length: ${n} }, (_, i) => tools.echo({ i }))); return "done";`;
    const call =
      mode === "codemode"
        ? fauxToolCall("codemode", { code }, { id: "c1" })
        : fauxToolCall("plain", { n, shape }, { id: "c1" });
    faux.setResponses([
      fauxAssistantMessage([call], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("ok")]),
    ]);
    const storage = yield* awaited(openNodeSqliteStorage(joinPath(directory, "session.sqlite")));
    const harness = yield* awaited(
      Harness.open(storage, { models, registry, settings: {} }, context),
    );
    const root = yield* awaited(
      harness.root(context, {
        agent: { model: { modelId: "faux-1", provider: "faux" } },
      }),
    );
    let commits = 0;
    harness.subscribeCommits(() => {
      commits++;
    });
    const started = performance.now();
    yield* awaited(
      (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
    );
    const ms = performance.now() - started;
    yield* awaited(harness.close(context));
    yield* awaited(sandbox.close());
    return { commits, ms };
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => removeDir(directory)))));
});

const sizes = (process.argv[2] ?? "100,1000").split(",").map(Number);

const main = Effect.gen(function* () {
  for (const shape of ["sequential", "parallel"] as const) {
    for (const n of sizes) {
      const plainRun = yield* run("plain", shape, n);
      const codemodeRun = yield* run("codemode", shape, n);
      const per = (value: number) => (value / n).toFixed(2);
      yield* Console.log(
        `${shape} n=${n}: plain ${plainRun.ms.toFixed(0)} ms (${per(plainRun.ms)} ms, ${per(plainRun.commits)} commits/call), codemode ${codemodeRun.ms.toFixed(0)} ms (${per(codemodeRun.ms)} ms, ${per(codemodeRun.commits)} commits/call)`,
      );
    }
  }
});

NodeRuntime.runMain(main);
