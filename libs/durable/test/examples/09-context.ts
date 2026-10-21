import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import type aiTypes from "@msa/ai/index.types";
import modelsModule from "@msa/ai/models";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import harnessModule from "../../src/harness/index.ts";
import memory from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { createModels } = modelsModule;

const { BACKGROUND_CONTEXT } = contextModule;

const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

const mainStep1 = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      { models: createModels(), registry: createRegistry() },
      context,
    ),
  );

  function assistantMessage(
    text: string,
    calls: readonly string[] = [],
    stopReason?: aiTypes.StopReason,
  ): aiTypes.AssistantMessage {
    return {
      api: "example",
      content: [
        { text, type: "text" },
        ...calls.map((id) => ({ arguments: {}, id, name: "read", type: "toolCall" as const })),
      ],
      model: "example",
      provider: "example",
      role: "assistant",
      stopReason: stopReason ?? (calls.length > 0 ? "toolUse" : "stop"),
      timestamp: 2,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    };
  }
  return { assistantMessage, harness };
});

const mainStep2 = Effect.gen(function* () {
  const { harness, assistantMessage } = yield* mainStep1;
  function toolResultMessage(id: string): aiTypes.ToolResultMessage {
    return {
      content: [{ text: `file ${id}`, type: "text" }],
      isError: false,
      role: "toolResult",
      timestamp: 3,
      toolCallId: id,
      toolName: "read",
    };
  }

  function show(message: aiTypes.Message): string {
    switch (message.role) {
      case "user":
        return `user: ${message.content as string}`;
      case "system":
        return `system: ${JSON.stringify(message.sections)}`;
      case "assistant":
        return `assistant: ${message.content
          .map((part) =>
            part.type === "text" ? part.text : part.type === "toolCall" ? `call(${part.id})` : "",
          )
          .join(" ")}`;
      case "toolResult":
        return `result(${message.toolCallId})${message.isError ? " error" : ""}`;
    }
  }

  const transcript = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const say = (kind: string, ...model: aiTypes.Message[]) =>
    transcript.commit((tx) => tx.appendEntry(transcript.id, { kind, model }), context);
  return { assistantMessage, harness, say, show, toolResultMessage, transcript };
});

const mainStep3 = Effect.gen(function* () {
  const { harness, assistantMessage, toolResultMessage, show, transcript, say } = yield* mainStep2;
  const question = yield* awaited(
    say("message", { content: "read a and b", role: "user", timestamp: 1 }),
  );
  yield* awaited(say("message", assistantMessage("I crashed", [], "aborted")));
  const calls = yield* awaited(say("message", assistantMessage("reading", ["a", "b"])));
  yield* awaited(say("message", toolResultMessage("b")));
  yield* awaited(
    say("msa.system", {
      content: "",
      role: "system",
      sections: { cwd: "<cwd>/repo</cwd>" },
      timestamp: 4,
    }),
  );
  yield* awaited(say("message", toolResultMessage("a")));
  yield* awaited(say("message", assistantMessage("a and b look fine")));
  yield* awaited(
    transcript.commit(
      (tx) =>
        tx.appendEntry(transcript.id, {
          data: "user fixed a typo",
          edits: [
            {
              action: "replace",
              messages: [{ content: "read files a and b", role: "user", timestamp: 1 }],
              target: question.id,
            },
          ],
          kind: "edit",
        }),
      context,
    ),
  );
  yield* awaited(
    transcript.commit(
      (tx) => tx.appendEntry(transcript.id, { data: "display only", kind: "note" }),
      context,
    ),
  );
  return { calls, harness, show, transcript };
});

const main = Effect.gen(function* () {
  const { harness, show, transcript, calls } = yield* mainStep3;
  let view = yield* awaited(transcript.context(context));
  yield* Console.log(
    "raw active entries:",
    view.entries.map((entry) => entry.kind),
  );
  yield* Console.log("request messages:", view.messages.map(show));

  const cut = yield* awaited(
    transcript.fork(calls.id, { ownership: { kind: "ownerless" } }, context),
  );
  yield* Console.log("fork messages:", (yield* awaited(cut.context(context))).messages.map(show));

  yield* awaited(
    transcript.commit(
      (tx) =>
        tx.appendEntry(transcript.id, {
          head: "self",
          kind: "summary",
          model: [{ content: "Summary: a and b are fine.", role: "user", timestamp: 5 }],
        }),
      context,
    ),
  );
  view = yield* awaited(transcript.context(context));
  yield* Console.log("after summary:", view.head?.kind, view.messages.map(show));

  const history = yield* awaited(transcript.entries({}, 3, undefined, context));
  yield* Console.log(
    "newest stored entries:",
    history.items.map((entry) => entry.kind),
    "more:",
    history.next !== undefined,
  );

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
