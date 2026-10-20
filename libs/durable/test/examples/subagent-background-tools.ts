import { type AssistantMessage, Type } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect } from "effect";

import {
  AssistantEntry,
  type ConversationId,
  type EntryId,
  LiveDoc,
  type TaskId,
  type ToolExecutionApi,
  type Tx,
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
} from "../../src/index.ts";
import effectSupport from "../effect-support.ts";

const { awaited } = effectSupport;

type Subagent = {
  conversationId: ConversationId;
  reported: EntryId[];
};

const Subagents = defineDoc<{
  agents: Record<string, Subagent>;
  reporters: Record<string, TaskId>;
}>({
  fork: "initial",
  history: "latest",
  initial: () => ({ agents: {}, reporters: {} }),
  kind: "app.subagents",
  scope: "conversation",
  version: 1,
});

const Anchor = defineTask<null, { phase: "done" }, null>({
  abort: (_anchor, runtime, taskContext) =>
    runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), taskContext),
  initial: () => ({ phase: "done" }),
  name: "app.subagent-anchor",
  phases: {
    done: (_anchor, runtime, taskContext) =>
      runtime.commit(
        () => ({ outcome: { result: null, status: "completed" }, status: "terminal" }),
        taskContext,
      ),
  },
  version: 1,
});

type ReporterInput = {
  name: string;
  conversationId: ConversationId;
  message: string;
  followUp: boolean;
};

type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string };

const next = (report?: string) =>
  ({
    checkpoint: { phase: "report", ...(report === undefined ? {} : { report }) },
    status: "running",
  }) as const;

const Reporter = defineTask<ReporterInput, ReporterState, null>({
  abort: (_reporter, runtime, taskContext) =>
    runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), taskContext),
  initial: () => ({ phase: "deliver" }),
  name: "app.subagent-reporter",
  phases: {
    deliver: (reporter, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const { name, conversationId, message, followUp } = reporter.input;
          const subagent = (yield* awaited(runtime.conversation(conversationId, taskContext)))!;
          const request = {
            content: message,
            type: "input",
            whenBusy: followUp ? "followUp" : "steer",
          } as const;
          const submission = yield* awaited(
            subagent.submit({ ...request, requestId: `subagent:${reporter.id}` }, taskContext),
          );
          const settled = yield* awaited(submission.wait(taskContext));
          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    if (settled.status === "unanswered") {
                      return next(
                        settled.reason === "aborted"
                          ? undefined
                          : `[subagent ${name} failed: ${settled.reason}]`,
                      );
                    }
                    if (settled.type !== "input") return next();
                    const agent = (yield* awaited(tx.doc(Subagents, runtime.conversationId)))
                      .agents[name]!;
                    if (agent.reported.includes(settled.answer)) return next();
                    agent.reported.push(settled.answer);
                    const answer = (yield* awaited(tx.entry(AssistantEntry, settled.answer)))
                      ?.model?.[0] as AssistantMessage;
                    return next(`[subagent ${name} answered, no reply needed] ${textOf(answer)}`);
                  }),
                ),
              taskContext,
            ),
          );
        }),
      ),
    report: (reporter, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const report = reporter.state.checkpoint.report;
          if (report !== undefined) {
            const main = (yield* awaited(
              runtime.conversation(runtime.conversationId, taskContext),
            ))!;
            const input = { content: report, type: "input", whenBusy: "followUp" } as const;
            yield* awaited(
              main.submit({ ...input, requestId: `subagent-report:${reporter.id}` }, taskContext),
            );
          }
          yield* awaited(
            runtime.commit(
              () => ({ outcome: { result: null, status: "completed" }, status: "terminal" }),
              taskContext,
            ),
          );
        }),
      ),
  },
  version: 1,
});

function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
}

const statusLines = Effect.fn("statusLines")(function* (
  api: ToolExecutionApi,
  agents: Readonly<Record<string, Subagent>>,
  name: string | undefined,
  callContext: Context,
) {
  const names = name === undefined ? Object.keys(agents) : [name];
  const lines: string[] = [];
  for (const each of names) {
    const found = Object.hasOwn(agents, each) ? agents[each] : undefined;
    if (found === undefined) continue;
    const busy =
      (yield* awaited(api.snapshot(LiveDoc, found.conversationId, callContext)))?.run !== undefined;
    lines.push(`${each}: ${busy ? "working" : "idle"}`);
  }
  return lines.length === 0 ? "No subagents." : lines.join("\n");
});

function startReporter(
  tx: Tx,
  api: ToolExecutionApi,
  {
    action,
    name,
    message,
    followUp,
  }: { action: "spawn" | "send"; name: string; message: string; followUp: boolean | undefined },
): Promise<string> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const state = yield* awaited(tx.doc(Subagents, api.conversationId));
      const background = { background: true, ownership: { kind: "conversation" } } as const;
      if (action === "spawn") {
        if (Object.hasOwn(state.agents, name)) return `${name} already exists; use send.`;
        const anchor = yield* awaited(tx.createTask(Anchor, null, background));
        const child = yield* awaited(
          tx.createConversation({ ownership: { kind: "task", taskId: anchor } }),
        );
        yield* awaited(
          configure(tx, child.id, {
            extensions: { remove: [SubagentTools] },
            instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
          }),
        );
        state.agents[name] = { conversationId: child.id, reported: [] };
      }
      const conversationId = state.agents[name]!.conversationId;
      const input = {
        conversationId,
        followUp: action === "send" && followUp === true,
        message,
        name,
      };
      state.reporters[api.taskId] = yield* awaited(tx.createTask(Reporter, input, background));
      return action === "send" ? `Sent to ${name}.` : `Started ${name}.`;
    }),
  );
}

const subagentTool = defineTool({
  description:
    "Manage persistent subagents that work in the background. Actions: spawn (name, message), send (name, message; " +
    "followUp: true queues it after the current answer instead of steering), stop (name: aborts its current work), " +
    "status (name, or all subagents without one). Answers are reported back to you when they arrive.",
  execute: (args, api, callContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { action, name, message, followUp } = args;
        const reply = (text: string, conversationId?: ConversationId) => ({
          content: [{ text, type: "text" as const }],
          ...(conversationId === undefined || name === undefined
            ? {}
            : { details: { conversationId, name } }),
        });
        const registry = (yield* awaited(
          api.snapshot(Subagents, api.conversationId, callContext),
        )) ?? {
          agents: {},
          reporters: {},
        };

        if (action === "status")
          return reply(yield* statusLines(api, registry.agents, name, callContext));
        if (name === undefined) return reply(`${action} needs a name.`);
        const agent = Object.hasOwn(registry.agents, name) ? registry.agents[name] : undefined;
        if (action !== "spawn" && agent === undefined) return reply(`No subagent named ${name}.`);

        if (action === "stop") {
          yield* awaited(
            (yield* awaited(api.conversation(agent!.conversationId, callContext)))!.abort(
              callContext,
            ),
          );
          return reply(`Stopped ${name}.`, agent!.conversationId);
        }
        if (message === undefined) return reply(`${action} needs a message.`);

        const result = yield* awaited(
          api.commit(
            (tx) => startReporter(tx, api, { action, followUp, message, name }),
            callContext,
          ),
        );
        const current = (yield* awaited(api.snapshot(Subagents, api.conversationId, callContext)))
          ?.agents[name];
        return reply(result, current?.conversationId);
      }),
    ),
  name: "subagent",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("spawn"),
      Type.Literal("send"),
      Type.Literal("stop"),
      Type.Literal("status"),
    ]),
    followUp: Type.Optional(Type.Boolean()),
    message: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
  }),
  replay: "unsafe",
});

const SubagentTools = defineExtension({
  name: "subagent-tools",
  tasks: [Anchor, Reporter],
  tools: [subagentTool],
});

const subagentBackgroundTools = {
  SubagentTools,
  Subagents,
  textOf,
};

export default subagentBackgroundTools;
