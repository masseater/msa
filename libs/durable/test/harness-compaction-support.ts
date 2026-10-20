import { type AssistantMessage, type SimpleStreamOptions, type TranscriptContext } from "@msa/ai";
import type durableTypes from "@msa/durable/index.types";
import type memoryTypes from "@msa/durable/storage/memory.types";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { expect } from "vite-plus/test";

import durableKit from "./durable-kit.ts";
import harnessCompactionMessages from "./harness-compaction-messages.ts";
import type harnessCompactionSupportTypes from "./harness-compaction-support.types.ts";
import support from "./support.ts";

const { durable, memory, sqliteNode: node } = durableKit;

const { MemoryStorage } = memory;
const { LiveDoc, UsageDoc } = durable;
const { openNodeSqliteStorage } = node;

const { BLOCKING, MANUAL, answer, isSummaryRequest, summary, text } = harnessCompactionMessages;

const {
  aborted,
  addSection,
  allEntries,
  awaited,
  chatSetup,
  context,
  deferred,
  joinPath,
  makeTempDir,
  openChat,
} = support;

const directories = new Set<string>();

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-compaction-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

function script(setup: ReturnType<typeof chatSetup>): harnessCompactionSupportTypes.Script {
  const result: harnessCompactionSupportTypes.Script = {
    agent: [],
    agentRequests: [],
    summaries: [],
    summaryRequests: [],
  };
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
          const request = { messages: [...transcript.messages], model: model!.id, options };
          const summarizing = isSummaryRequest(request.messages);
          (summarizing ? result.summaryRequests : result.agentRequests).push(request);
          const step = (summarizing ? result.summaries : result.agent).shift();
          if (step === undefined)
            return Promise.reject(
              new Error(`No scripted ${summarizing ? "summary" : "agent"} response`),
            );
          return Promise.resolve(typeof step === "function" ? step(request) : step);
        },
    ),
  );
  return result;
}

function gatedImpl(
  gate: PromiseWithResolvers<void>,
  message: AssistantMessage,
  reached?: PromiseWithResolvers<void>,
): harnessCompactionSupportTypes.Step {
  return ({ options }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        reached?.resolve();
        yield* awaited(Promise.race([gate.promise, aborted(options!.signal!)]));
        return message;
      }),
    );
}

const gated: {
  (
    message: AssistantMessage,
    reached?: PromiseWithResolvers<void>,
  ): (gate: PromiseWithResolvers<void>) => ReturnType<typeof gatedImpl>;
  (
    gate: PromiseWithResolvers<void>,
    message: AssistantMessage,
    reached?: PromiseWithResolvers<void>,
  ): ReturnType<typeof gatedImpl>;
} = dual((args) => "resolve" in args[0], gatedImpl);

const open = Effect.fn("open")(function* (
  options: {
    readonly policy?: durableTypes.CompactionPolicy;
    readonly contextWindow?: number;
    readonly storage?: memoryTypes.MemoryStorage;
  } = {},
  setup: ReturnType<typeof chatSetup> = chatSetup({
    models: [{ contextWindow: options.contextWindow ?? 100_000, id: "faux-1", maxTokens: 900 }],
  }),
  faux: harnessCompactionSupportTypes.Script = script(setup),
) {
  addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
  const { harness, root } = yield* openChat(options.storage ?? new MemoryStorage(), setup);
  setup.settings.stream = { cacheRetention: "none" };
  setup.settings.compaction = options.policy ?? MANUAL;
  setup.settings.retry = { baseDelayMs: 1, enabled: true, maxRetries: 2 };
  harness.resume();
  return { faux, harness, root, setup };
});

const turn = Effect.fn("turn")(function* (
  chat: harnessCompactionSupportTypes.Chat,
  user: string,
  reply: string,
) {
  chat.faux.agent.push(answer(reply));
  const submission = yield* awaited(chat.root.submit({ content: user, type: "input" }, context));
  expect((yield* awaited(submission.wait(context))).status).toBe("done");
});

const history = Effect.fn("history")(function* (chat: harnessCompactionSupportTypes.Chat) {
  yield* turn(chat, text("u1", 100), text("a1", 100));
  yield* turn(chat, text("u2", 100), text("a2", 100));
  yield* turn(chat, text("u3", 100), text("a3", 100));
});

function resultImpl(
  chat: harnessCompactionSupportTypes.Chat,
  id: durableTypes.TaskId<durableTypes.CompactionResult>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const record = yield* awaited(chat.harness.waitForTask(id, context));
      return record.state.outcome;
    }),
  );
}

const result: {
  (
    id: durableTypes.TaskId<durableTypes.CompactionResult>,
  ): (chat: harnessCompactionSupportTypes.Chat) => ReturnType<typeof resultImpl>;
  (
    chat: harnessCompactionSupportTypes.Chat,
    id: durableTypes.TaskId<durableTypes.CompactionResult>,
  ): ReturnType<typeof resultImpl>;
} = dual(2, resultImpl);

const kinds = Effect.fn("kinds")(function* (conversation: durableTypes.Conversation) {
  return (yield* allEntries(conversation)).map((entry) => entry.kind);
});

function live(chat: harnessCompactionSupportTypes.Chat) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return (yield* awaited(chat.harness.snapshot(LiveDoc, chat.root.id, context))) ?? {};
    }),
  );
}

const compactionInput = Effect.fn("compactionInput")(function* (
  chat: harnessCompactionSupportTypes.Chat,
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

const compactionTasks = Effect.fn("compactionTasks")(function* (
  chat: harnessCompactionSupportTypes.Chat,
) {
  const inspection = yield* awaited(chat.harness.inspect(context));
  return inspection.tasks
    .map((task) => task.record)
    .filter((record) => record.kind === "msa.compaction");
});

const reopen = Effect.fn("reopen")(function* (
  path: string,
  setup: ReturnType<typeof chatSetup>,
  faux: harnessCompactionSupportTypes.Script,
) {
  const { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  harness.resume();
  return { faux, harness, root, setup };
});

function first(path: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const setup = chatSetup();
      addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
      const faux = script(setup);
      const { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
      setup.settings.compaction = MANUAL;
      setup.settings.retry = { baseDelayMs: 1, enabled: true, maxRetries: 2 };
      harness.resume();
      const chat = { faux, harness, root, setup };
      yield* history(chat);
      return chat;
    }),
  );
}

const blockingRun = Effect.fn("blockingRun")(function* (chat: harnessCompactionSupportTypes.Chat) {
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary("BLOCKING"), reached));
  const input = yield* awaited(
    chat.root.submit({ content: text("u4", 200), type: "input" }, context),
  );
  yield* awaited(reached.promise);
  const [blocking] = yield* compactionTasks(chat);
  return {
    blocking: blocking!.id as durableTypes.TaskId<durableTypes.CompactionResult>,
    gate,
    input,
  };
});

const harnessCompactionSupport = {
  ...harnessCompactionMessages,
  blockingRun,
  compactionInput,
  compactionTasks,
  directories,
  first,
  gated,
  history,
  kinds,
  live,
  open,
  reopen,
  result,
  script,
  sqlitePath,
  turn,
};

export default harnessCompactionSupport;
