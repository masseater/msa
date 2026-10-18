import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall, Type } from "@msa/ai";
import type { Context } from "@msa/chord";
import {
  type AgentEvent,
  type Conversation,
  defineTask,
  defineTool,
  type Harness,
  type JoinPolicy,
  type NextTaskState,
  type Registry,
  type Storage,
  type TaskId,
  type TaskOptions,
  type TaskRuntime,
  type ToolRegistration,
  type Tx,
} from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";

import { waitFor } from "./chat-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred, openTasks } from "./task-support.ts";

export type NodeInput = { name: string };

export type NodeCheckpoint = { phase: "run" } | { phase: "resume"; round: number };

export type NodeRuntime = TaskRuntime<NodeInput, NodeCheckpoint, string, object>;

export type Next = NextTaskState<NodeCheckpoint, string>;

/** Per-name behavior of `Node`; unscripted parts use the defaults below. */
export type Behavior = {
  run?(runtime: NodeRuntime, ctx: Context): Promise<void>;
  resume?(runtime: NodeRuntime, ctx: Context, round: number): Promise<void>;
  abort?(runtime: NodeRuntime, ctx: Context): Promise<void>;
};

/** How a default run ends once its gate opens: its outcome, or a throw that faults it. */
export type Ending = "completed" | "failed" | "throw";

export const behaviors = new Map<string, Behavior>();

export const gates = new Map<string, Deferred<Ending>>();

/** Handler starts and ends in order, such as `run:a`, `abort:a`. */
export const log: string[] = [];

export function gate(name: string): Deferred<Ending> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<Ending>();
    gates.set(name, found);
  }
  return found;
}

export function open(name: string, ending: Ending = "completed"): void {
  gate(name).resolve(ending);
}

export function script(name: string, behavior: Behavior): void {
  behaviors.set(name, behavior);
}

// Wait for the gate or the abort signal, then end as the gate says.
export async function defaultRun(runtime: NodeRuntime, ctx: Context, name: string): Promise<void> {
  const ending = await Promise.race([gate(name).promise, aborted(runtime.signal)]);
  if (ending === "throw") throw new Error(`${name} threw`);
  await runtime.commit(() => end(ending, name), ctx);
}

export function end(ending: "completed" | "failed", name: string): Next {
  return ending === "completed"
    ? { status: "terminal", outcome: { status: "completed", result: name } }
    : { status: "terminal", outcome: { status: "failed", error: { message: `${name} failed` } } };
}

/** A task that runs its name's behavior. */
export const Node = defineTask<NodeInput, NodeCheckpoint, string>({
  name: "test.node",
  version: 1,
  initial: () => ({ phase: "run" }),
  phases: {
    run: async (task, runtime, ctx) => {
      const name = task.input.name;
      log.push(`run:${name}`);
      const behavior = behaviors.get(name)?.run;
      await (behavior === undefined ? defaultRun(runtime, ctx, name) : behavior(runtime, ctx));
    },
    resume: async (task, runtime, ctx) => {
      const name = task.input.name;
      log.push(`resume:${name}`);
      const behavior = behaviors.get(name)?.resume;
      if (behavior !== undefined) return behavior(runtime, ctx, task.state.checkpoint.round);
      await runtime.commit(() => end("completed", name), ctx);
    },
  },
  abort: async (task, runtime, ctx) => {
    const name = task.input.name;
    log.push(`abort:${name}`);
    const behavior = behaviors.get(name)?.abort;
    if (behavior !== undefined) return behavior(runtime, ctx);
    await runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted", result: name } }),
      ctx,
    );
  },
});

/** Never registered: aborting it can only orphan it. */
export const Unregistered = defineTask<NodeInput, { phase: "run" }, string>({
  name: "test.unregistered",
  version: 1,
  initial: () => ({ phase: "run" }),
  phases: { run: async () => {} },
  abort: async () => {},
});

export const OWN_CONVERSATION: TaskOptions = { ownership: { kind: "conversation" } };

export function owned(owner: TaskId): TaskOptions {
  return { ownership: { kind: "task", taskId: owner } };
}

// A child task named `name`, owned by `owner`.
export function spawn(tx: Tx, owner: TaskId, name: string): Promise<TaskId<string>> {
  return tx.createTask(Node, { name }, owned(owner));
}

// Wait on `on`, resuming in round `round`.
export function waitOn(on: readonly TaskId[], policy: JoinPolicy, round = 1): Next {
  return { status: "waiting", checkpoint: { phase: "resume", round }, on, policy };
}

export function start(
  conversation: Conversation,
  name: string,
  options: TaskOptions = OWN_CONVERSATION,
) {
  return Promise.resolve(
    conversation.commit((tx) => tx.createTask(Node, { name }, options), context),
  );
}

export type Opened = {
  harness: Harness;
  root: Conversation;
  registry: Registry;
  reports: unknown[];
};

export async function openNodes(storage: Storage = new MemoryStorage()): Promise<Opened> {
  const opened = await openTasks(storage, [Node]);
  const root = await opened.harness.root(context);
  opened.harness.resume();
  return { ...opened, root };
}

export async function state(harness: Harness, id: TaskId) {
  return (await harness.getTask(id, context))!.state;
}

export async function outcomeOf(harness: Harness, id: TaskId): Promise<string> {
  return (await harness.waitForTask(id, context)).state.outcome.status;
}

export async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  await waitFor(check);
}

export const directories = new Set<string>();

export async function sqlitePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msa-durable-structured-"));
  directories.add(directory);
  return join(directory, "session.sqlite");
}

// Script `parent` to spawn `children` in one commit and wait on them with `policy`; it records their outcomes.
export function parentOf(parent: string, children: readonly string[], policy: JoinPolicy) {
  const found = { ids: [] as TaskId<string>[], outcomes: [] as string[] };
  script(parent, {
    run: (runtime, ctx) =>
      runtime.commit(async (tx) => {
        for await (const name of children) found.ids.push(await spawn(tx, runtime.taskId, name));
        return waitOn(found.ids, policy);
      }, ctx),
    resume: async (runtime, ctx) => {
      found.outcomes = (await runtime.outcomes(found.ids, ctx)).map((outcome) => outcome.status);
      await runtime.commit(() => end("completed", parent), ctx);
    },
  });
  return found;
}

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

// Script `name` to spawn `child` and then complete, holding while the child lives.
export function spawnAndFinish(name: string, child: string): { id?: TaskId } {
  const found: { id?: TaskId } = {};
  script(name, {
    run: async (runtime, ctx) => {
      await runtime.commit(async (tx) => {
        found.id = await spawn(tx, runtime.taskId, child);
        return { status: "running", checkpoint: { phase: "resume", round: 1 } };
      }, ctx);
    },
  });
  return found;
}

export async function listen(harness: Harness, conversation: Conversation) {
  const stream = await watchEvents(harness, conversation.id, context);
  const events: AgentEvent[] = [];
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { stream, events };
}

// Event types, with tool ends and message ends labelled by call ID and whether an entry came along.
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
