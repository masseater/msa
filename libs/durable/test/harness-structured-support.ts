import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import harnessStructuredNodes from "./harness-structured-nodes.ts";
import type harnessStructuredSupportTypes from "./harness-structured-support.types.ts";
import support from "./support.ts";

const {
  Node,
  behaviors,
  defaultRun,
  end,
  gate,
  gates,
  log,
  owned,
  parentOf,
  script,
  spawn,
  state,
  waitOn,
} = harnessStructuredNodes;

const { defineTask } = durable;
const { MemoryStorage } = memory;

const { awaited, context, joinPath, makeTempDir, openTasks, waitFor } = support;

function openImpl(name: string, ending: harnessStructuredSupportTypes.Ending = "completed"): void {
  gate(name).resolve(ending);
}

const open: {
  (ending?: harnessStructuredSupportTypes.Ending): (name: string) => ReturnType<typeof openImpl>;
  (name: string, ending?: harnessStructuredSupportTypes.Ending): ReturnType<typeof openImpl>;
} = dual(
  (args) => args.length === 2 || !["completed", "failed", "throw"].includes(args[0]),
  openImpl,
);
const Unregistered = defineTask<harnessStructuredSupportTypes.NodeInput, { phase: "run" }, string>({
  abort: () => Promise.resolve(),
  initial: () => ({ phase: "run" }),
  name: "test.unregistered",
  phases: { run: () => Promise.resolve() },
  version: 1,
});

const OWN_CONVERSATION: durableTypes.TaskOptions = { ownership: { kind: "conversation" } };

function startImpl(
  conversation: durableTypes.Conversation,
  name: string,
  options: durableTypes.TaskOptions = OWN_CONVERSATION,
): Promise<durableTypes.TaskId<string>> {
  return Promise.resolve(
    conversation.commit((tx) => tx.createTask(Node, { name }, options), context),
  );
}

const start: {
  (
    name: string,
    options?: durableTypes.TaskOptions,
  ): (conversation: durableTypes.Conversation) => ReturnType<typeof startImpl>;
  (
    conversation: durableTypes.Conversation,
    name: string,
    options?: durableTypes.TaskOptions,
  ): ReturnType<typeof startImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, startImpl);

const openNodes = Effect.fn("openNodes")(function* (
  storage: durableTypes.Storage = new MemoryStorage(),
) {
  const opened = yield* openTasks(storage, [Node]);
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  return { ...opened, root };
});

function outcomeOfImpl(harness: durableTypes.Harness, id: durableTypes.TaskId): Promise<string> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return (yield* awaited(harness.waitForTask(id, context))).state.outcome.status;
    }),
  );
}

const outcomeOf: {
  (id: durableTypes.TaskId): (harness: durableTypes.Harness) => ReturnType<typeof outcomeOfImpl>;
  (harness: durableTypes.Harness, id: durableTypes.TaskId): ReturnType<typeof outcomeOfImpl>;
} = dual(2, outcomeOfImpl);

const until = Effect.fn("until")(function* (check: Parameters<typeof waitFor>[0]) {
  yield* waitFor(check);
});

const directories = new Set<string>();

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-structured-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});
const harnessStructuredSupport = {
  Node,
  OWN_CONVERSATION,
  Unregistered,
  behaviors,
  defaultRun,
  directories,
  end,
  gate,
  gates,
  log,
  open,
  openNodes,
  outcomeOf,
  owned,
  parentOf,
  script,
  spawn,
  sqlitePath,
  start,
  state,
  until,
  waitOn,
};

export default harnessStructuredSupport;
