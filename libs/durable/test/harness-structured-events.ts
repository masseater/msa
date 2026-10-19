import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import type { AgentEvent, Conversation, Harness, TaskId, ToolRegistration } from "@msa/durable";
import { defineTool } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import { awaited } from "./effect-support.ts";
import { script, spawn } from "./harness-structured-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

export function blockingTool(name: string): {
  started: Promise<void>;
  registration: ToolRegistration;
} {
  const started = deferred();
  return {
    started: started.promise,
    registration: defineTool({
      name,
      description: `The ${name} tool`,
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: (_args, api, callContext) => {
        api.output("partial");
        started.resolve();
        return Promise.resolve(aborted(callContext.abortSignal!));
      },
    }),
  };
}

export function toolCalls(...ids: readonly [string, string][]) {
  return fauxAssistantMessage(
    ids.map(([name, id]) => fauxToolCall(name, {}, { id })),
    { stopReason: "toolUse" },
  );
}

function spawnAndFinishImpl(name: string, child: string): { id?: TaskId } {
  const found: { id?: TaskId } = {};
  script(name, {
    run: (runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    found.id = yield* awaited(spawn(tx, runtime.taskId, child));
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  return found;
}

export const spawnAndFinish: {
  (child: string): (name: string) => ReturnType<typeof spawnAndFinishImpl>;
  (name: string, child: string): ReturnType<typeof spawnAndFinishImpl>;
} = dual(2, spawnAndFinishImpl);

export const listen = Effect.fn("listen")(function* (harness: Harness, conversation: Conversation) {
  const stream = yield* awaited(watchEvents(harness, conversation.id, context));
  const events: AgentEvent[] = [];
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { stream, events };
});

export function labels(events: readonly AgentEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type === "tool_execution_end")
      return [`end:${event.toolCallId}:${event.entry !== undefined}`];
    if (event.type === "message_end") {
      const message = event.entry.model?.[0];
      return [
        message?.role === "toolResult"
          ? `result:${message.toolCallId}`
          : `message:${message?.role}`,
      ];
    }
    return [];
  });
}
