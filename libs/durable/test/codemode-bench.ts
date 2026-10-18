import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { CodemodeSandbox } from "@msa/codemode";
import { Console, Effect } from "effect";
import { Type } from "typebox";

import { createCodemodeTool } from "../src/codemode/codemode.ts";
import { createRegistry, Harness } from "../src/harness/index.ts";
import { defineExtension, defineTool } from "../src/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import { joinPath, makeTempDir, removeDir } from "./platform-support.ts";

type Shape = "sequential" | "parallel";

const echo = defineTool({
  name: "echo",
  description: "echo",
  parameters: Type.Object({ i: Type.Number() }),
  execute: (args) => Promise.resolve({ output: [{ type: "text", text: String(args.i) }] }),
});

const plain = defineTool({
  name: "plain",
  description: "plain",
  parameters: Type.Object({ n: Type.Number(), shape: Type.String() }),
  replay: "safe",
  execute: (args, api, callContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (args.shape === "sequential") {
          for (const i of Array.from({ length: args.n }, (_, i) => i))
            yield* awaited(api.executeTool("echo", { i }, callContext));
        } else {
          yield* awaited(
            Promise.all(
              Array.from({ length: args.n }, (_, i) => api.executeTool("echo", { i }, callContext)),
            ),
          );
        }
        return { output: [{ type: "text", text: "done" }] };
      }),
    ),
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
        agent: { model: { provider: "faux", modelId: "faux-1" } },
      }),
    );
    let commits = 0;
    harness.subscribeCommits(() => {
      commits++;
    });
    const started = performance.now();
    yield* awaited(
      (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
    );
    const ms = performance.now() - started;
    yield* awaited(harness.close(context));
    yield* awaited(sandbox.close());
    return { ms, commits };
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
