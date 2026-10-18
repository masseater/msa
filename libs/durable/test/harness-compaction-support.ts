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
  type TaskId,
  UsageDoc,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { expect } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, type ChatSetup, chatSetup, openChat, textOf } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addSection } from "./harness-support.ts";
import { joinPath, makeTempDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";

export const directories = new Set<string>();

export const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-compaction-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

function textImpl(label: string, tokens: number): string {
  return `${label} ${"x".repeat(Math.max(0, tokens * 4 - label.length - 1))}`;
}

export const text: {
  (tokens: number): (label: string) => ReturnType<typeof textImpl>;
  (label: string, tokens: number): ReturnType<typeof textImpl>;
} = dual(2, textImpl);

export type Request = {
  readonly messages: readonly Message[];
  readonly options: SimpleStreamOptions | undefined;
  readonly model: string;
};

export type Step =
  | AssistantMessage
  | ((request: Request) => AssistantMessage | Promise<AssistantMessage>);

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

function gatedImpl(gate: Deferred, message: AssistantMessage, reached?: Deferred): Step {
  return ({ options }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        reached?.resolve();
        yield* awaited(Promise.race([gate.promise, aborted(options!.signal!)]));
        return message;
      }),
    );
}

export const gated: {
  (message: AssistantMessage, reached?: Deferred): (gate: Deferred) => ReturnType<typeof gatedImpl>;
  (gate: Deferred, message: AssistantMessage, reached?: Deferred): ReturnType<typeof gatedImpl>;
} = dual((args) => "resolve" in args[0], gatedImpl);

export const answer = (content: string) => fauxAssistantMessage(content);

export const failure = (errorMessage: string) =>
  fauxAssistantMessage("", { stopReason: "error", errorMessage });

export const OVERFLOW = "prompt is too long: 250000 tokens > 200000 maximum";

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

export const open = Effect.fn("open")(function* (
  options: {
    readonly policy?: CompactionPolicy;
    readonly contextWindow?: number;
    readonly storage?: MemoryStorage;
  } = {},
  setup: ChatSetup = chatSetup({
    models: [{ id: "faux-1", contextWindow: options.contextWindow ?? 100_000, maxTokens: 900 }],
  }),
  faux: Script = script(setup),
) {
  addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
  const { harness, root } = yield* openChat(options.storage ?? new MemoryStorage(), setup);
  setup.settings.stream = { cacheRetention: "none" };
  setup.settings.compaction = options.policy ?? MANUAL;
  setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 1 };
  harness.resume();
  return { harness, root, setup, faux };
});

export const turn = Effect.fn("turn")(function* (chat: Chat, user: string, reply: string) {
  chat.faux.agent.push(answer(reply));
  const submission = yield* awaited(chat.root.submit({ type: "input", content: user }, context));
  expect((yield* awaited(submission.wait(context))).status).toBe("done");
});

export const history = Effect.fn("history")(function* (chat: Chat) {
  yield* turn(chat, text("u1", 100), text("a1", 100));
  yield* turn(chat, text("u2", 100), text("a2", 100));
  yield* turn(chat, text("u3", 100), text("a3", 100));
});

export const summary = (content = "SUMMARY") => answer(content);

function resultImpl(chat: Chat, id: TaskId<CompactionResult>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const record = yield* awaited(chat.harness.waitForTask(id, context));
      return record.state.outcome;
    }),
  );
}

export const result: {
  (id: TaskId<CompactionResult>): (chat: Chat) => ReturnType<typeof resultImpl>;
  (chat: Chat, id: TaskId<CompactionResult>): ReturnType<typeof resultImpl>;
} = dual(2, resultImpl);

export const kinds = Effect.fn("kinds")(function* (conversation: Conversation) {
  return (yield* allEntries(conversation)).map((entry) => entry.kind);
});

export function live(chat: Chat) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return (yield* awaited(chat.harness.snapshot(LiveDoc, chat.root.id, context))) ?? {};
    }),
  );
}

export function userText(message: Message | undefined): string {
  return textOf(message) ?? "";
}

export function firstUserText(messages: readonly Message[]): string {
  return userText(messages.find((message) => message.role === "user"));
}

export const user = (content: string): UserMessage => ({ role: "user", content, timestamp: 0 });

export const compactionInput = Effect.fn("compactionInput")(function* (
  chat: Chat,
  run: () => Promise<unknown>,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const input = () =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context)))!.models[
          "faux/faux-1"
        ]!.input;
      }),
    );
  const before = yield* awaited(input());
  yield* awaited(run());
  return (yield* awaited(input())) - before;
});

export const BACKGROUND: CompactionPolicy = {
  enabled: true,
  reserveTokens: 500,
  keepRecentTokens: 150,
  backgroundTokens: 1000,
};

export const BLOCKING: CompactionPolicy = {
  enabled: true,
  reserveTokens: 300,
  keepRecentTokens: 150,
  backgroundTokens: 0,
};

export const compactionTasks = Effect.fn("compactionTasks")(function* (chat: Chat) {
  const inspection = yield* awaited(chat.harness.inspect(context));
  return inspection.tasks
    .map((task) => task.record)
    .filter((record) => record.kind === "msa.compaction");
});

export const ENABLED: CompactionPolicy = { ...MANUAL, enabled: true };

export const reopen = Effect.fn("reopen")(function* (path: string, setup: ChatSetup, faux: Script) {
  const { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  harness.resume();
  return { harness, root, setup, faux };
});

export function first(path: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const setup = chatSetup();
      addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
      const faux = script(setup);
      const { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
      setup.settings.compaction = MANUAL;
      setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 1 };
      harness.resume();
      const chat = { harness, root, setup, faux };
      yield* history(chat);
      return chat;
    }),
  );
}

export const blockingRun = Effect.fn("blockingRun")(function* (chat: Chat) {
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary("BLOCKING"), reached));
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 200) }, context),
  );
  yield* awaited(reached.promise);
  const [blocking] = yield* compactionTasks(chat);
  return { input, gate, blocking: blocking!.id as TaskId<CompactionResult> };
});
