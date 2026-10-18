import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Type } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createRegistry, Harness, watchEvents } from "../../src/harness/index.ts";
import { type AgentEvent, defineExtension, defineTool, type LiveState } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { toJsonText, awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;
const pause = (ms: number) => Effect.sleep(ms);

const registry = createRegistry();
registry.install(
  defineExtension({
    name: "count",
    tools: [
      defineTool({
        name: "count",
        description: "Counts to ten",
        parameters: Type.Object({}),
        execute: (_args, api) =>
          Effect.runPromise(
            Effect.gen(function* () {
              for (const n of Array.from({ length: 10 }, (_, i) => 1 + i)) {
                api.output(`${n}\n`);
                yield* pause(100);
              }
              return {};
            }),
          ),
      }),
    ],
  }),
);
const faux = fauxProvider({ tokensPerSecond: 40, tokenSize: { min: 1, max: 1 } });
faux.setResponses([
  fauxAssistantMessage([fauxToolCall("count", {}, { id: "call-1" })], { stopReason: "toolUse" }),
  fauxAssistantMessage([fauxText("Counted to ten, and this answer streams slowly.")]),
]);
const models = createModels();
models.setProvider(faux.provider);

const main = Effect.gen(function* () {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());

  const harness = yield* awaited(Harness.open(new MemoryStorage(), { models, registry }, context));
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    }),
  );

  const submission = yield* awaited(
    root.submit({ type: "input", content: "Count to ten, then tell me." }, context),
  );
  yield* pause(500);

  const view = yield* awaited(root.viewState(context));
  const live = view.value.docs["msa.live"] as LiveState;
  yield* Console.log(
    "view entries:",
    view.value.entries.map((entry) => entry.kind),
  );
  yield* Console.log(
    "view tool slot:",
    live.tools?.[0]?.status,
    yield* toJsonText(live.tools?.[0]?.output),
  );
  view.subscribe((value) => {
    const slot = (value.docs["msa.live"] as LiveState).tools?.[0];
    if (slot?.status === "running")
      runSync(Console.log("view output now:", JSON.stringify(slot.output)));
  });

  const stream = yield* awaited(watchEvents(harness, root.id, context));
  yield* Console.log(
    "snapshot tools:",
    stream.snapshot.tools.map((slot) => `${slot.name} ${slot.status}`),
  );
  let output = stream.snapshot.tools[0]?.output ?? "";
  stream.start((events: readonly AgentEvent[]) => {
    for (const event of events) {
      if (event.type === "tool_execution_update" && event.output !== undefined) {
        output =
          "set" in event.output
            ? event.output.set
            : output.slice(event.output.trimStart ?? 0) + (event.output.append ?? "");
        runSync(Console.log("event output now:", JSON.stringify(output)));
      } else if (event.type === "message_update") {
        const deltas = event.changes.flatMap((change) =>
          change.type === "text_delta" ? [change.delta] : [],
        );
        runSync(Console.log("event text delta:", JSON.stringify(deltas.join(""))));
      } else {
        runSync(Console.log("event:", event.type));
      }
    }

    return Promise.resolve();
  });

  yield* awaited(submission.wait(context));
  yield* awaited(harness.waitForIdle(context));
  yield* pause(1);
  yield* awaited(stream.stop());
  view.dispose();
  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
