import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { type Message, createModels } from "@msa/ai";
import { openaiProvider } from "@msa/ai/providers/openai";
import { AssistantEntry, LiveDoc, defineExtension, section } from "@msa/durable";
import { Harness, createRegistry } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import support from "../support.ts";

const { BACKGROUND_CONTEXT, awaited, environmentVariable } = support;

const context = BACKGROUND_CONTEXT;

const openHarness = Effect.gen(function* () {
  const models = createModels();
  models.setProvider(openaiProvider());
  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "concise",
      sections: [section("preamble", () => "You are a concise assistant.", { tag: false })],
    }),
  );
  const harness = yield* awaited(Harness.open(new MemoryStorage(), { models, registry }, context));
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "gpt-6-sol", provider: "openai" }, thinkingLevel: "high" },
    }),
  );
  return { harness, root };
});

const textBlock = (message: Message | undefined) =>
  message?.role === "assistant"
    ? message.content.find((content) => content.type === "text")
    : undefined;

const askForPoem = Effect.gen(function* () {
  const { harness, root } = yield* openHarness;
  const liveWatch = (yield* awaited(harness.watchDoc(LiveDoc, root.id, context)))!;
  let printed = "";
  const printText = (text: string): void => {
    if (text.length <= printed.length || !text.startsWith(printed)) return;
    process.stdout.write(text.slice(printed.length));
    printed = text;
  };
  liveWatch.start((value) => {
    const block = textBlock(value?.generation?.message);
    if (block?.type === "text") printText(block.text);

    return Promise.resolve();
  });
  harness.resume();
  process.stdout.write("answer: ");
  const poem = yield* awaited(
    root.submit({ content: "Write a long poem", type: "input" }, context),
  );
  const settledPoem = yield* awaited(poem.wait(context));
  yield* awaited(liveWatch.stop());
  if (settledPoem.status === "done" && settledPoem.type === "input") {
    const entry = yield* awaited(
      root.commit((tx) => tx.entry(AssistantEntry, settledPoem.answer), context),
    );
    const block = textBlock(entry?.model?.[0]);
    if (block?.type === "text") printText(block.text);
    process.stdout.write("\n");
  } else {
    yield* Console.log("unanswered:", settledPoem.reason, settledPoem.detail);
  }
  yield* awaited(harness.close(context));
});

const main = Effect.gen(function* () {
  if (environmentVariable("OPENAI_API_KEY", true) === undefined) {
    yield* Console.log("skipped: OPENAI_API_KEY is not set");
  } else {
    yield* askForPoem;
  }
});

NodeRuntime.runMain(main);
