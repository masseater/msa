import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import modelsModule from "@msa/ai/models";
import fauxModule from "@msa/ai/providers/faux";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";
import { Type } from "typebox";

import harnessModule from "../src/harness/index.ts";
import durable from "../src/index.ts";
import memory from "../src/storage/memory.ts";
import effectSupport from "./effect-support.ts";

const { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } = fauxModule;
const { createModels } = modelsModule;

const { BACKGROUND_CONTEXT: context } = contextModule;

const { Harness, createRegistry } = harnessModule;
const { ToolResultEntry, defineExtension, defineTool } = durable;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

function fanModels() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const leaf = defineTool({
    description: "Return at once",
    execute: () => Promise.resolve({ output: [{ text: "ok", type: "text" }] }),
    name: "leaf",
    parameters: Type.Object({ n: Type.Number() }),
  });
  const fan = defineTool({
    description: "Call leaf in parallel",
    execute: (args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const results = yield* awaited(
            Promise.all(
              Array.from({ length: args.count }, (_, n) =>
                api.executeTool("leaf", { n }, callContext, { progress: false }),
              ),
            ),
          );
          const failed = results.filter((result) => result.isError).length;
          return { isError: failed > 0, output: [{ text: `${failed} failed`, type: "text" }] };
        }),
      ),
    name: "fan",
    parameters: Type.Object({ count: Type.Number() }),
  });
  registry.install(defineExtension({ name: "bench", tools: [leaf, fan] }));
  return { faux, models, registry };
}

const run = Effect.fn("run")(function* (calls: number) {
  const { faux, models, registry } = fanModels();
  const storage = new MemoryStorage();
  let commits = 0;
  const commit = storage.commit.bind(storage);
  storage.commit = (writes, commitContext) => {
    commits++;
    return commit(writes, commitContext);
  };
  const harness = yield* awaited(Harness.open(storage, { models, registry }, context));
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("fan", { count: calls }, { id: "fan" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const started = performance.now();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  if (settled.status !== "done") throw new Error(`run: ${settled.status}`);
  yield* awaited(harness.waitForIdle(context));
  const ms = Math.round(performance.now() - started);
  const page = yield* awaited(root.entries({}, 10, undefined, context));
  const result = page.items.find((entry) => ToolResultEntry.is(entry))?.model?.[0];
  if (result?.role !== "toolResult" || result.isError) throw new Error(`run: nested calls failed`);
  yield* awaited(harness.close(context));
  return { commits, ms };
});

const sizes = process.argv.slice(2).map(Number);
Effect.runSync(Console.log("calls | ms     | commits | ms per call"));

const main = Effect.gen(function* () {
  for (const calls of sizes.length > 0 ? sizes : [250, 500, 1000, 2000, 4000]) {
    const { ms, commits } = yield* run(calls);
    yield* Console.log(
      `${String(calls).padEnd(5)} | ${String(ms).padEnd(6)} | ${String(commits).padEnd(7)} | ${(ms / calls).toFixed(2)}`,
    );
  }
});

NodeRuntime.runMain(main);
