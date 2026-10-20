import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  type AssistantMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import { openaiProvider } from "@msa/ai/providers/openai";
import { AssistantEntry, defineExtension, section } from "@msa/durable";
import { Harness, createRegistry } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createBashTool, createReadTool } from "../../src/tools/index.ts";
import support from "../support.ts";

const { BACKGROUND_CONTEXT, awaited, environmentVariable } = support;

const context = BACKGROUND_CONTEXT;
const prompt = process.argv[2] ?? "What is in this directory?";

const models = createModels();
let model = { modelId: "gpt-6-sol", provider: "openai" };
if (environmentVariable("OPENAI_API_KEY", true) === undefined) {
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  model = { modelId: "faux-1", provider: "faux" };
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("bash", { command: "ls" }, { id: "call-1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([
      fauxText("This directory holds the durable package sources, tests, and docs."),
    ]),
  ]);
} else {
  models.setProvider(openaiProvider());
}

const registry = createRegistry();
registry.install(
  defineExtension({
    name: "coding",
    sections: [section("preamble", () => "You are a concise coding assistant.", { tag: false })],
    tools: [createReadTool(), createBashTool()],
  }),
);
const env = new NodeExecutionEnv({ cwd: process.cwd() });

const main = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { env: () => env, models, registry }, context),
  );
  const root = yield* awaited(harness.root(context, { agent: { model } }));

  const submission = yield* awaited(root.submit({ content: prompt, type: "input" }, context));
  const settled = yield* awaited(submission.wait(context));
  if (settled.status === "done" && settled.type === "input") {
    const entry = yield* awaited(
      root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
    );
    const answer = entry?.model?.[0] as AssistantMessage;
    yield* Console.log(
      answer.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join(""),
    );
  } else {
    yield* Console.error(
      `unanswered: ${settled.status === "unanswered" ? settled.reason : settled.status}`,
    );
    process.exitCode = 1;
  }
  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
