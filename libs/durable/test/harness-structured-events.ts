import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import harnessStructuredSupport from "./harness-structured-support.ts";
import testSupport from "./support.ts";

const { defineTool } = durable;
const { watchEvents } = harnessModule;

const { awaited } = testSupport;
const { script, spawn } = harnessStructuredSupport;
const { context } = testSupport;
const { aborted, deferred } = testSupport;

function blockingTool(name: string): {
  started: Promise<void>;
  registration: durableTypes.ToolRegistration;
} {
  const started = deferred();
  return {
    registration: defineTool({
      description: `The ${name} tool`,
      execute: (_args, api, callContext) => {
        api.output("partial");
        started.resolve();
        return Promise.resolve(aborted(callContext.abortSignal!));
      },
      executionMode: "sequential",
      name,
      parameters: Type.Object({}),
    }),
    started: started.promise,
  };
}

function toolCalls(...ids: readonly [string, string][]) {
  return fauxAssistantMessage(
    ids.map(([name, id]) => fauxToolCall(name, {}, { id })),
    { stopReason: "toolUse" },
  );
}

function spawnAndFinishImpl(name: string, child: string): { id?: durableTypes.TaskId } {
  const found: { id?: durableTypes.TaskId } = {};
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
                    return { checkpoint: { phase: "resume", round: 1 }, status: "running" };
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

const spawnAndFinish: {
  (child: string): (name: string) => ReturnType<typeof spawnAndFinishImpl>;
  (name: string, child: string): ReturnType<typeof spawnAndFinishImpl>;
} = dual(2, spawnAndFinishImpl);

const listen = Effect.fn("listen")(function* (
  harness: durableTypes.Harness,
  conversation: durableTypes.Conversation,
) {
  const stream = yield* awaited(watchEvents(harness, conversation.id, context));
  const events: durableTypes.AgentEvent[] = [];
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { events, stream };
});

function labels(events: readonly durableTypes.AgentEvent[]): string[] {
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

const harnessStructuredEvents = {
  blockingTool,
  labels,
  listen,
  spawnAndFinish,
  toolCalls,
};

export default harnessStructuredEvents;
