import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import type { AssistantMessage, Message, TranscriptContext } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { Harness, createRegistry } from "../../src/harness/index.ts";
import { CompactionEntry, type Conversation, LiveDoc } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

let overflowOnce = false;
let summaries = 0;
let hold: Promise<void> | undefined;
function respond(transcript: TranscriptContext): Promise<AssistantMessage> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const first = transcript.messages[0];
      if (
        first?.role === "system" &&
        typeof first.content === "string" &&
        first.content.includes("summarization")
      ) {
        summaries++;
        return fauxAssistantMessage(`## Goal\nPlan a week in Lisbon (summary #${summaries}).`);
      }
      if (overflowOnce) {
        overflowOnce = false;
        return fauxAssistantMessage("", {
          errorMessage: "prompt is too long",
          stopReason: "error",
        });
      }
      const held = hold;
      hold = undefined;
      yield* awaited(held);
      const question = transcript.messages.findLast((message) => message.role === "user");
      return fauxAssistantMessage(
        `A detailed answer to "${text(question)}": ${"details ".repeat(200)}`,
      );
    }),
  );
}
const faux = fauxProvider({ models: [{ contextWindow: 3000, id: "tiny", maxTokens: 1000 }] });
faux.setResponses(Array.from({ length: 100 }, () => respond));
const models = createModels();
models.setProvider(faux.provider);

let backgroundTokens = 800;
const settings = {
  get compaction() {
    return { backgroundTokens, keepRecentTokens: 400, reserveTokens: 1000 };
  },
};

const show = Effect.fn("show")(function* (conversation: Conversation, label: string) {
  const view = yield* awaited(conversation.context(context));
  const stored = (yield* awaited(conversation.entries({}, 1000, undefined, context))).items.length;
  yield* Console.log(
    `\n${label}: ${view.messages.length} messages in context, ${stored} entries stored`,
  );
  const reason = CompactionEntry.is(view.head) ? view.head.data.reason : undefined;
  if (reason !== undefined) yield* Console.log(`  (${reason} compaction summary first)`);
  for (const message of view.messages) {
    yield* Console.log(
      `  ${message.role.padEnd(9)} ${message.role === "system" ? "(system prompt)" : text(message).slice(0, 70)}`,
    );
  }
});

function text(message: Message | undefined): string {
  if (message === undefined || message.role === "system") return "";
  if (typeof message.content === "string") return message.content;
  const block = message.content.find((content) => content.type === "text");
  return block?.type === "text" ? block.text.replaceAll("\n", " ") : "";
}

const mainStep1 = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { models, registry: createRegistry(), settings }, context),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "tiny", provider: "faux" } },
    }),
  );

  const ask = Effect.fn("ask")(function* (question: string) {
    const submission = yield* awaited(root.submit({ content: question, type: "input" }, context));
    const record = yield* awaited(submission.wait(context));
    const running =
      (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))?.compactions ?? [];
    for (const { taskId } of running) yield* awaited(harness.waitForTask(taskId, context));
    yield* show(
      root,
      `after "${question}" (${record.status === "done" ? "answered" : record.reason})`,
    );
  });

  for (const question of [
    "Where should we stay?",
    "What should we eat?",
    "Which day trips?",
    "Any museums?",
    "Nightlife?",
  ]) {
    yield* ask(question);
  }

  const answer = Promise.withResolvers<void>();
  const finishAnswer = () => answer.resolve();
  hold = answer.promise;
  const busy = yield* awaited(
    root.submit({ content: "How do we get around?", type: "input" }, context),
  );
  const manual = yield* awaited(root.compact("Keep the hotel shortlist", context));
  const { state } = yield* awaited(harness.waitForTask(manual, context));
  const placement =
    state.outcome.status === "completed" ? state.outcome.result.submissionId : undefined;
  const summary = (yield* awaited(harness.submission(placement!, context)))!;
  return { ask, busy, finishAnswer, harness, root, summary };
});

const main = Effect.gen(function* () {
  const { harness, root, ask, finishAnswer, busy, summary } = yield* mainStep1;
  yield* Console.log(
    "\nmanual compaction finished; its summary is",
    (yield* awaited(summary.status(context))).status,
  );
  finishAnswer();
  yield* awaited(busy.wait(context));
  yield* Console.log(
    "after the answer, the summary is",
    (yield* awaited(summary.wait(context))).status,
  );
  yield* show(root, "after compact()");

  backgroundTokens = 0;
  yield* ask("What should we pack?");
  overflowOnce = true;
  yield* ask("Summarize the plan for my partner");

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
