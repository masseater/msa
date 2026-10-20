import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  type AssistantMessage,
  type FauxResponseStep,
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import { openaiProvider } from "@msa/ai/providers/openai";
import type { Context } from "@msa/chord";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import support from "../support.ts";

const { AssistantEntry, configure, defineExtension, defineTool } = durable;
const { Harness, createRegistry, watchEvents } = harnessModule;
const { MemoryStorage } = memory;

const { BACKGROUND_CONTEXT, awaited, environmentVariable } = support;

const context = BACKGROUND_CONTEXT;

const answerText = Effect.fn("answerText")(function* (
  api: durableTypes.ToolExecutionApi,
  answer: durableTypes.EntryId,
  callContext: Context,
) {
  const entry = yield* awaited(api.commit((tx) => tx.entry(AssistantEntry, answer), callContext));
  const message = entry?.model?.[0] as AssistantMessage;
  return message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
});

const Subagent: durableTypes.Extension = defineExtension({
  name: "subagent",
  tools: [
    defineTool({
      description: "Delegate a self-contained task to a subagent and get its answer back.",
      execute: (args, api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            const { task } = args;
            const child = yield* awaited(
              api.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      const existing = (yield* awaited(
                        tx.scanConversations({ ownerTaskId: api.taskId }, 1),
                      )).items[0];
                      if (existing !== undefined) return existing.id;
                      const created = yield* awaited(
                        tx.createConversation({
                          ownership: { kind: "task", taskId: api.taskId },
                        }),
                      );
                      yield* awaited(
                        configure(tx, created.id, { extensions: { remove: [Subagent] } }),
                      );
                      return created.id;
                    }),
                  ),
                callContext,
              ),
            );
            yield* awaited(api.details({ conversationId: child }, callContext));

            const handle = (yield* awaited(api.conversation(child, callContext)))!;
            const request = {
              content: task,
              requestId: `subagent:${api.taskId}`,
              type: "input",
            } as const;
            const settled = yield* awaited(
              (yield* awaited(handle.submit(request, callContext))).wait(callContext),
            );
            if (settled.status !== "done" || settled.type !== "input") {
              throw new Error(`Subagent failed: ${settled.status}`);
            }
            const text = yield* answerText(api, settled.answer, callContext);
            return { details: { conversationId: child }, output: [{ text, type: "text" }] };
          }),
        ),
      name: "subagent",
      parameters: Type.Object({
        task: Type.String({ description: "What the subagent should do" }),
      }),
      replay: "safe",
    }),
  ],
});

const models = createModels();
let model = { modelId: "gpt-6-sol", provider: "openai" };
if (environmentVariable("OPENAI_API_KEY", true) === undefined) {
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  model = { modelId: "faux-1", provider: "faux" };
  const delegate = fauxToolCall(
    "subagent",
    { task: "Name three prime numbers." },
    { id: "call-1" },
  );
  faux.setResponses([
    fauxAssistantMessage([delegate], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("2, 3, and 5.")]),
    fauxAssistantMessage([fauxText("The subagent says: 2, 3, and 5.")]),
  ] satisfies FauxResponseStep[]);
} else {
  models.setProvider(openaiProvider());
}
const registry = createRegistry();
registry.install(Subagent);

const mainStep1 = Effect.gen(function* () {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());

  const harness = yield* awaited(Harness.open(new MemoryStorage(), { models, registry }, context));
  const root = yield* awaited(harness.root(context, { agent: { model } }));

  const print = (indent: string, event: durableTypes.AgentEvent): void => {
    if (event.type === "message_end" && event.entry.kind === "msa.assistant") {
      const message = event.entry.model?.[0] as AssistantMessage;
      const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
      if (text !== "") runSync(Console.log(`${indent}assistant: ${text}`));
    } else if (event.type === "tool_execution_start") {
      runSync(Console.log(`${indent}tool ${event.toolName}(${JSON.stringify(event.args)})`));
    }
  };
  const attached = new Set<durableTypes.ConversationId>();
  const attach = Effect.fn("attach")(function* (id: durableTypes.ConversationId, indent: string) {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    attached.add(id);
    const stream = yield* awaited(watchEvents(harness, id, context));
    stream.start((events) =>
      runPromise(
        Effect.gen(function* () {
          for (const event of events) {
            print(indent, event);
            if (event.type !== "tool_execution_update") continue;
            const child = (
              event.details as { conversationId?: durableTypes.ConversationId } | undefined
            )?.conversationId;
            if (child !== undefined && !attached.has(child)) yield* attach(child, `${indent}  `);
          }
        }),
      ),
    );
  });
  yield* attach(root.id, "");
  return { harness, root };
});

const main = Effect.gen(function* () {
  const { harness, root } = yield* mainStep1;
  const submission = yield* awaited(
    root.submit(
      {
        content: "Use the subagent tool to find three prime numbers, then tell me what it said.",
        type: "input",
      },
      context,
    ),
  );
  yield* awaited(submission.wait(context));
  yield* awaited(harness.waitForIdle(context));
  yield* Effect.sleep(1);
  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
