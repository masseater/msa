import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type { ExecutionEnv } from "../env/index.ts";
import type { SessionImpl } from "../session/session.ts";
import { AgentDoc, resolveAgent, resolveSettings } from "./agent.ts";
import { toPromise } from "./bridge.ts";
import type { Wired } from "./harness-wiring.ts";
import type {
  Agent,
  ConversationId,
  HarnessInspection,
  HarnessOptions,
  RegistrySnapshot,
  Storage,
  ToolRegistration,
} from "./types.ts";
import { addUsageState, UsageDoc, type UsageState } from "./usage.ts";
import { scanAll } from "./util.ts";

const SCAN_PAGE_SIZE = 256;

export type QuerySession = { readonly session: SessionImpl; readonly storage: Storage };

export const totalUsage = Effect.fn("totalUsage")(function* (
  { session, storage }: QuerySession,
  context: Context,
) {
  const scan = yield* toPromise(() =>
    scanAll((cursor) => storage.scanConversations({}, SCAN_PAGE_SIZE, cursor, context)),
  );
  const conversations = yield* Effect.promise(() => session.readOnLine(scan));
  const total: UsageState = UsageDoc.definition.initial();
  yield* Effect.forEach(
    conversations,
    ({ id }) =>
      Effect.map(
        Effect.promise(() => session.snapshot(UsageDoc, id, context)),
        (state) => {
          if (state !== undefined) addUsageState(total, state);
        },
      ),
    { discard: true },
  );
  return total;
});

const scanSubmissions = (storage: Storage, status: "queued" | "placed", context: Context) =>
  scanAll((cursor) => storage.scanSubmissions({ status }, SCAN_PAGE_SIZE, cursor, context));

export const inspectHarness = Effect.fn("inspectHarness")(function* (
  { session, storage }: QuerySession,
  tasks: Wired["tasks"],
  snapshot: RegistrySnapshot,
  context: Context,
) {
  const read = yield* toPromise(() =>
    Effect.gen(function* () {
      const { scheduling, tasks: inspected } = yield* Effect.promise(() => tasks.inspect(snapshot));
      const queued = yield* scanSubmissions(storage, "queued", context);
      const placed = yield* scanSubmissions(storage, "placed", context);
      const submissions = [...queued, ...placed].sort((a, b) => a.id - b.id);
      return { scheduling, tasks: inspected, submissions } satisfies HarnessInspection;
    }),
  );
  return yield* Effect.promise(() => session.readOnLine(read));
});

export const buildEnv = Effect.fn("buildEnv")(function* <Tool extends ToolRegistration>(
  session: SessionImpl,
  options: HarnessOptions<Tool>,
  id: ConversationId,
  context: Context,
) {
  const build = options.env;
  if (build === undefined) return undefined;
  const cwd = (yield* Effect.promise(() => session.snapshot(AgentDoc, id, context)))?.cwd;
  return yield* Effect.promise(() =>
    Promise.resolve<ExecutionEnv | undefined>(
      build({ conversationId: id, ...(cwd === undefined ? {} : { cwd }), read: session }, context),
    ),
  );
});

export type BuiltEnv = ExecutionEnv | undefined;

export type AgentQuery<Tool extends ToolRegistration> = {
  readonly session: SessionImpl;
  readonly options: HarnessOptions<Tool>;
  readonly report: (error: unknown) => void;
};

export const conversationAgent = Effect.fn("conversationAgent")(function* <
  Tool extends ToolRegistration,
>(
  query: AgentQuery<Tool>,
  id: ConversationId,
  snapshot: RegistrySnapshot<Tool> | undefined,
  context: Context,
) {
  const registry = snapshot ?? query.options.registry.snapshot();
  const settings = resolveSettings(query.options.settings);
  const state = yield* Effect.promise(() => query.session.snapshot(AgentDoc, id, context));
  const agent: Agent<Tool> = resolveAgent(state, registry, settings, query.report);
  return agent;
});
