import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider } from "@msa/ai/providers/faux";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import harnessModule from "../../src/harness/index.ts";
import durable from "../../src/index.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { Harness, createRegistry } = harnessModule;
const { AssistantEntry, defineExtension, section } = durable;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([fauxAssistantMessage("Paris.")]);

const registry = createRegistry();
registry.install(
  defineExtension({
    name: "terse",
    sections: [section("preamble", () => "You answer in one word.", { tag: false })],
  }),
);

const main = Effect.gen(function* () {
  const harness = yield* awaited(Harness.open(new MemoryStorage(), { models, registry }, context));
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );

  const capital = yield* awaited(
    root.submit({ content: "Capital of France?", type: "input" }, context),
  );
  const answered = yield* awaited(capital.wait(context));
  if (answered.status === "done" && answered.type === "input") {
    const entry = yield* awaited(
      root.commit((tx) => tx.entry(AssistantEntry, answered.answer), context),
    );
    const reply = entry?.model?.[0];
    yield* Console.log("answer:", reply?.role === "assistant" ? reply.content : reply);
  }

  const transcript = yield* awaited(root.entries({}, 10, undefined, context));
  yield* Console.log(
    "transcript:",
    [...transcript.items].reverse().map((entry) => entry.kind),
  );
  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
