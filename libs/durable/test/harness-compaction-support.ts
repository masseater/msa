import { join } from "node:path";

import {
  type AssistantMessage,
  fauxAssistantMessage,
  type Message,
  type SimpleStreamOptions,
  type TranscriptContext,
  type UserMessage,
} from "@msa/ai";
import {
  type CompactionPolicy,
  type CompactionResult,
  type Conversation,
  type Harness,
  LiveDoc,
  MemoryStorage,
  type TaskId,
  UsageDoc,
} from "@msa/durable";
import { expect } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, type ChatSetup, chatSetup, openChat, textOf } from "./chat-support.ts";
import { addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";
import { makeTempDir } from "./temp-support.ts";

export const directories = new Set<string>();

export async function sqlitePath(): Promise<string> {
  const directory = await makeTempDir("msa-durable-compaction-");
  directories.add(directory);
  return join(directory, "session.sqlite");
}

// Text of about `tokens` estimated tokens, starting with `label`.
export function text(label: string, tokens: number): string {
  return `${label} ${"x".repeat(Math.max(0, tokens * 4 - label.length - 1))}`;
}

export type Request = {
  readonly messages: readonly Message[];
  readonly options: SimpleStreamOptions | undefined;
  readonly model: string;
};

export type Step =
  | AssistantMessage
  | ((request: Request) => AssistantMessage | Promise<AssistantMessage>);

/** Scripted faux model that answers agent requests and summarization requests from separate queues. */
export type Script = {
  readonly agent: Step[];
  readonly summaries: Step[];
  readonly agentRequests: Request[];
  readonly summaryRequests: Request[];
};

export function isSummaryRequest(messages: readonly Message[]): boolean {
  const first = messages[0];
  return (
    first?.role === "system" &&
    typeof first.content === "string" &&
    first.content.startsWith("You are a context summarization assistant")
  );
}

export function script(setup: ChatSetup): Script {
  const result: Script = { agent: [], summaries: [], agentRequests: [], summaryRequests: [] };
  setup.faux.setResponses(
    Array.from(
      { length: 500 },
      () =>
        (
          transcript: TranscriptContext,
          options?: SimpleStreamOptions,
          _state?: unknown,
          model?: { id: string },
        ) => {
          const request = { messages: [...transcript.messages], options, model: model!.id };
          const summary = isSummaryRequest(request.messages);
          (summary ? result.summaryRequests : result.agentRequests).push(request);
          const step = (summary ? result.summaries : result.agent).shift();
          if (step === undefined)
            return Promise.reject(
              new Error(`No scripted ${summary ? "summary" : "agent"} response`),
            );
          return Promise.resolve(typeof step === "function" ? step(request) : step);
        },
    ),
  );
  return result;
}

// A step that waits for `gate`, or rejects when the request is cancelled.
export function gated(gate: Deferred, message: AssistantMessage, reached?: Deferred): Step {
  return async ({ options }) => {
    reached?.resolve();
    await Promise.race([gate.promise, aborted(options!.signal!)]);
    return message;
  };
}

export const answer = (content: string) => fauxAssistantMessage(content);

export const failure = (errorMessage: string) =>
  fauxAssistantMessage("", { stopReason: "error", errorMessage });

export const OVERFLOW = "prompt is too long: 250000 tokens > 200000 maximum";

/** Small thresholds: no automatic compaction unless a test enables it. */
export const MANUAL: CompactionPolicy = {
  enabled: false,
  reserveTokens: 1000,
  keepRecentTokens: 150,
  backgroundTokens: 0,
};

export type Chat = {
  readonly harness: Harness;
  readonly root: Conversation;
  readonly setup: ChatSetup;
  readonly faux: Script;
};

export async function open(
  options: {
    readonly policy?: CompactionPolicy;
    readonly contextWindow?: number;
    readonly storage?: MemoryStorage;
  } = {},
  setup = chatSetup({
    models: [{ id: "faux-1", contextWindow: options.contextWindow ?? 100_000, maxTokens: 900 }],
  }),
  faux = script(setup),
): Promise<Chat> {
  addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
  const { harness, root } = await openChat(options.storage ?? new MemoryStorage(), setup);
  // These tests exercise compaction accounting and thresholds, not the faux provider's cache simulation.
  setup.settings.stream = { cacheRetention: "none" };
  setup.settings.compaction = options.policy ?? MANUAL;
  setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 1 };
  harness.resume();
  return { harness, root, setup, faux };
}

// Run one turn: `user` answered by `reply`.
export async function turn(chat: Chat, user: string, reply: string): Promise<void> {
  chat.faux.agent.push(answer(reply));
  const submission = await chat.root.submit({ type: "input", content: user }, context);
  expect((await submission.wait(context)).status).toBe("done");
}

// Three turns of about 100-token messages.
export async function history(chat: Chat): Promise<void> {
  await turn(chat, text("u1", 100), text("a1", 100));
  await turn(chat, text("u2", 100), text("a2", 100));
  await turn(chat, text("u3", 100), text("a3", 100));
}

export const summary = (content = "SUMMARY") => answer(content);

export async function result(chat: Chat, id: TaskId<CompactionResult>) {
  const record = await chat.harness.waitForTask(id, context);
  return record.state.outcome;
}

export async function kinds(conversation: Conversation): Promise<string[]> {
  return (await allEntries(conversation)).map((entry) => entry.kind);
}

export async function live(chat: Chat) {
  return (await chat.harness.snapshot(LiveDoc, chat.root.id, context)) ?? {};
}

export function userText(message: Message | undefined): string {
  return textOf(message) ?? "";
}

// Text of the first user message; a leading baseline system message comes before it.
export function firstUserText(messages: readonly Message[]): string {
  return userText(messages.find((message) => message.role === "user"));
}

export const user = (content: string): UserMessage => ({ role: "user", content, timestamp: 0 });

// Input tokens a compaction added to the ledger.
export async function compactionInput(chat: Chat, run: () => Promise<unknown>): Promise<number> {
  const input = async () =>
    (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models["faux/faux-1"]!.input;
  const before = await input();
  await run();
  return (await input()) - before;
}

/** Background threshold at 500 and blocking threshold at 1500 tokens of a 2000-token window. */
export const BACKGROUND: CompactionPolicy = {
  enabled: true,
  reserveTokens: 500,
  keepRecentTokens: 150,
  backgroundTokens: 1000,
};

/** Blocking threshold at 700 tokens of a 1000-token window, no background compaction. */
export const BLOCKING: CompactionPolicy = {
  enabled: true,
  reserveTokens: 300,
  keepRecentTokens: 150,
  backgroundTokens: 0,
};

export async function compactionTasks(chat: Chat) {
  const inspection = await chat.harness.inspect(context);
  return inspection.tasks
    .map((task) => task.record)
    .filter((record) => record.kind === "msa.compaction");
}

export const ENABLED: CompactionPolicy = { ...MANUAL, enabled: true };

export async function reopen(path: string, setup: ChatSetup, faux: Script): Promise<Chat> {
  const { harness, root } = await openChat(await openNodeSqliteStorage(path), setup);
  harness.resume();
  return { harness, root, setup, faux };
}

export async function first(path: string) {
  const setup = chatSetup();
  addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
  const faux = script(setup);
  const { harness, root } = await openChat(await openNodeSqliteStorage(path), setup);
  setup.settings.compaction = MANUAL;
  setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 1 };
  harness.resume();
  const chat = { harness, root, setup, faux };
  await history(chat);
  return chat;
}

// A run whose generation waits on a blocking compaction whose summary is held; returns the input and gate.
export async function blockingRun(chat: Chat) {
  await history(chat);
  chat.setup.settings.compaction = BLOCKING;
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary("BLOCKING"), reached));
  const input = await chat.root.submit({ type: "input", content: text("u4", 200) }, context);
  await reached.promise;
  const [blocking] = await compactionTasks(chat);
  return { input, gate, blocking: blocking!.id as TaskId<CompactionResult> };
}
