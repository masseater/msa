import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import type { AssistantMessage, Message, StopReason, ToolResultMessage } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createRegistry, Harness } from "../../src/harness/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;

const main = Effect.gen(function* () {
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
    stopReason?: StopReason,
  ): AssistantMessage {
    return {
      role: "assistant",
      content: [
        { type: "text", text },
        ...calls.map((id) => ({ type: "toolCall" as const, id, name: "read", arguments: {} })),
      ],
      api: "example",
      provider: "example",
      model: "example",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: stopReason ?? (calls.length > 0 ? "toolUse" : "stop"),
      timestamp: 2,
    };
  }

  function toolResultMessage(id: string): ToolResultMessage {
    return {
      role: "toolResult",
      toolCallId: id,
      toolName: "read",
      content: [{ type: "text", text: `file ${id}` }],
      isError: false,
      timestamp: 3,
    };
  }

  function show(message: Message): string {
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
  const say = (kind: string, ...model: Message[]) =>
    transcript.commit((tx) => tx.appendEntry(transcript.id, { kind, model }), context);

  const question = yield* awaited(
    say("message", { role: "user", content: "read a and b", timestamp: 1 }),
  );
  yield* awaited(say("message", assistantMessage("I crashed", [], "aborted")));
  const calls = yield* awaited(say("message", assistantMessage("reading", ["a", "b"])));
  yield* awaited(say("message", toolResultMessage("b")));
  yield* awaited(
    say("msa.system", {
      role: "system",
      content: "",
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
          kind: "edit",
          data: "user fixed a typo",
          edits: [
            {
              target: question.id,
              action: "replace",
              messages: [{ role: "user", content: "read files a and b", timestamp: 1 }],
            },
          ],
        }),
      context,
    ),
  );
  yield* awaited(
    transcript.commit(
      (tx) => tx.appendEntry(transcript.id, { kind: "note", data: "display only" }),
      context,
    ),
  );

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
          kind: "summary",
          head: "self",
          model: [{ role: "user", content: "Summary: a and b are fine.", timestamp: 5 }],
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
