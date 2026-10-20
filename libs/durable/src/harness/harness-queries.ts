import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type sessionTypes from "../session/session.types.ts";
import agentModule from "./agent.ts";
import bridge from "./bridge.ts";
import type harnessQueriesTypes from "./harness-queries.types.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";
import type usageTypes from "./usage.types.ts";
import util from "./util.ts";

const { toPromise } = bridge;
const { scanAll } = util;
const { UsageDoc, addUsageState } = usageModule;
const { AgentDoc, resolveAgent, resolveSettings } = agentModule;

const SCAN_PAGE_SIZE = 256;

const totalUsage = Effect.fnUntraced(function* (
  { session, storage }: harnessQueriesTypes.QuerySession,
  context: Context,
) {
  const scan = yield* toPromise(() =>
    scanAll((cursor) => storage.scanConversations({}, SCAN_PAGE_SIZE, cursor, context)),
  );
  const conversations = yield* Effect.promise(() => session.readOnLine(scan));
  const total: usageTypes.UsageState = UsageDoc.definition.initial();
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

const scanSubmissions = (
  storage: typesModule.Storage,
  status: "queued" | "placed",
  context: Context,
) => scanAll((cursor) => storage.scanSubmissions({ status }, SCAN_PAGE_SIZE, cursor, context));

const inspectHarness = Effect.fnUntraced(function* (
  { session, storage }: harnessQueriesTypes.QuerySession,
  tasks: harnessQueriesTypes.Wired["tasks"],
  snapshot: typesModule.RegistrySnapshot,
  context: Context,
) {
  const read = yield* toPromise(() =>
    Effect.gen(function* () {
      const { scheduling, tasks: inspected } = yield* Effect.promise(() => tasks.inspect(snapshot));
      const queued = yield* scanSubmissions(storage, "queued", context);
      const placed = yield* scanSubmissions(storage, "placed", context);
      const submissions = [...queued, ...placed].sort((a, b) => a.id - b.id);
      return { scheduling, submissions, tasks: inspected } satisfies typesModule.HarnessInspection;
    }),
  );
  return yield* Effect.promise(() => session.readOnLine(read));
});

const buildEnv = Effect.fnUntraced(function* <Tool extends typesModule.ToolRegistration>(
  session: sessionTypes.SessionImpl,
  options: typesModule.HarnessOptions<Tool>,
  id: typesModule.ConversationId,
  context: Context,
) {
  const build = options.env;
  if (build === undefined) return undefined;
  const cwd = (yield* Effect.promise(() => session.snapshot(AgentDoc, id, context)))?.cwd;
  return yield* Effect.promise(() =>
    Promise.resolve<harnessQueriesTypes.ExecutionEnv | undefined>(
      build({ conversationId: id, ...(cwd === undefined ? {} : { cwd }), read: session }, context),
    ),
  );
});

const conversationAgent = Effect.fnUntraced(function* <Tool extends typesModule.ToolRegistration>(
  query: harnessQueriesTypes.AgentQuery<Tool>,
  id: typesModule.ConversationId,
  snapshot: typesModule.RegistrySnapshot<Tool> | undefined,
  context: Context,
) {
  const registry = snapshot ?? query.options.registry.snapshot();
  const settings = resolveSettings(query.options.settings);
  const state = yield* Effect.promise(() => query.session.snapshot(AgentDoc, id, context));
  const agent: typesModule.Agent<Tool> = resolveAgent(state, registry, settings, query.report);
  return agent;
});

const harnessQueries = {
  buildEnv,
  conversationAgent,
  inspectHarness,
  totalUsage,
};

export default harnessQueries;
