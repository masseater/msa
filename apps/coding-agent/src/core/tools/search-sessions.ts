import { type Static, Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import hitFormat from "../session-search/hit-format.ts";
import sessionSearch from "../session-search/session-search.ts";
import type sessionSearchTypes from "../session-search/session-search.types.ts";
import timeRangeModule from "../session-search/time-range.ts";

const { timeRange } = timeRangeModule;

const KINDS = ["user", "assistant", "tool_call", "tool_result"] as const;
const ROLES = ["orchestrator", "worker", "reviewer", "triage", "advisor", "session"] as const;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_AFTER = 10;

const stringList = (description: string) =>
  Type.Optional(Type.Array(Type.String(), { description, minItems: 1 }));

const searchSessionsSchema = Type.Object({
  action: Type.Optional(
    Type.Union([Type.Literal("search"), Type.Literal("read")], {
      description:
        "search (default): find messages by words; read: show a session from an entry a search returned, to keep reading",
    }),
  ),
  after: Type.Optional(
    Type.Integer({ description: "read: entries after `entry` (default 10)", minimum: 0 }),
  ),
  before: Type.Optional(
    Type.Integer({ description: "read: entries before `entry` (default 0)", minimum: 0 }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Only sessions whose working directory starts with this text" }),
  ),
  entry: Type.Optional(Type.String({ description: "read: the entry id a search result names" })),
  from: Type.Optional(
    Type.Integer({
      description: "read: characters of the first entry to skip, as the previous read says",
      minimum: 0,
    }),
  ),
  kinds: Type.Optional(
    Type.Array(Type.Union(KINDS.map((kind) => Type.Literal(kind))), {
      description:
        "Only these kinds: user (user messages), assistant (assistant text), tool_call (tool name and arguments), tool_result",
      minItems: 1,
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: `Most results to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})`,
      maximum: MAX_LIMIT,
      minimum: 1,
    }),
  ),
  order: Type.Optional(
    Type.Union([Type.Literal("relevance"), Type.Literal("newest"), Type.Literal("oldest")], {
      description: "relevance (default), newest, or oldest first",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        'Words that must all appear in one message, tool call, or tool result. Japanese words match as written. Quote a phrase to keep its words together: "vp test run"',
    }),
  ),
  roles: Type.Optional(
    Type.Array(Type.Union(ROLES.map((role) => Type.Literal(role))), {
      description:
        "Only sessions run as these: orchestrator, worker, reviewer, triage, advisor, or session (an ordinary session)",
      minItems: 1,
    }),
  ),
  rounds: stringList("Only threads of tasks in these rounds"),
  session: Type.Optional(
    Type.String({ description: "read: the session file a search result names" }),
  ),
  since: Type.Optional(
    Type.String({ description: "Only messages at or after this date (YYYY-MM-DD) or date-time" }),
  ),
  taskIds: stringList("Only threads that worked on these task ids"),
  threadIds: stringList("Only these orchestrator threads"),
  tools: stringList("Only calls to and results of these tools, such as bash or edit"),
  until: Type.Optional(
    Type.String({
      description: "Only messages before the end of this date (YYYY-MM-DD) or this date-time",
    }),
  ),
});

type Input = Static<typeof searchSessionsSchema>;

const searchSessionsToolSystemPromptContribution = {
  guidelines: [
    "Use search_sessions to find what the user decided or asked for and how earlier sessions and orchestrator threads did the work, before guessing or asking the user again",
  ],
  snippet: "Search past sessions: messages, tool calls, and tool results",
} as const;

function formatHit(hit: sessionSearchTypes.Hit, index: number): string {
  return [
    `${index + 1}. ${hitFormat.hitHeading(hit)}`,
    ...hitFormat.hitLocation(hit).map((line) => `   ${line}`),
    `   ${hit.snippet}`,
  ].join("\n");
}

function filtersOf(input: Input): sessionSearchTypes.Filters {
  return {
    cwd: input.cwd,
    kinds: input.kinds,
    roles: input.roles,
    rounds: input.rounds,
    taskIds: input.taskIds,
    threadIds: input.threadIds,
    tools: input.tools,
    ...timeRange(input.since, input.until),
  };
}

function runSearch(locations: sessionSearchTypes.Locations, input: Input): Promise<string> {
  const query = input.query?.trim() ?? "";
  if (query === "") return Promise.reject(new Error("search needs a query"));
  return sessionSearch
    .searchSessions(locations, {
      filters: filtersOf(input),
      limit: input.limit ?? DEFAULT_LIMIT,
      order: input.order ?? "relevance",
      query,
    })
    .then((hits) =>
      hits.length === 0 ? "No matching messages." : hits.map(formatHit).join("\n\n"),
    );
}

function runRead(locations: sessionSearchTypes.Locations, input: Input): Promise<string> {
  const { session, entry } = input;
  if (session === undefined || entry === undefined) {
    return Promise.reject(new Error("read needs the session and entry of a search result"));
  }
  return sessionSearch
    .readSession(locations, {
      after: input.after ?? DEFAULT_AFTER,
      before: input.before ?? 0,
      entry,
      from: input.from ?? 0,
      path: session,
    })
    .then((page) => {
      if (page === undefined) throw new Error(`No entry ${entry} in ${session}`);
      if (page.next === undefined) return page.text;
      return `${page.text}\n\n[More: action read, session ${session}, entry ${page.next.entry}, from ${page.next.from}]`;
    });
}

function createSearchSessionsToolDefinition(
  locations: sessionSearchTypes.Locations,
): extensionsTypesTypes.ToolDefinition<typeof searchSessionsSchema, undefined> {
  return {
    annotations: { readOnlyHint: true },
    description:
      "Search the conversations and work of past sessions, orchestrator threads included: user messages, assistant text, tool calls with their arguments, and full tool results. Filter by kind, tool, role (orchestrator, worker, reviewer, triage), task, thread, round, working directory, and time. Each result names its session and entry; read continues from there.",
    execute: (_toolCallId, input) =>
      Promise.resolve(input)
        .then((given) =>
          given.action === "read" ? runRead(locations, given) : runSearch(locations, given),
        )
        .then((text) => ({ content: [{ text, type: "text" }], details: undefined })),
    label: "search sessions",
    name: "search_sessions",
    parameters: searchSessionsSchema,
    promptGuidelines: [...searchSessionsToolSystemPromptContribution.guidelines],
    promptSnippet: searchSessionsToolSystemPromptContribution.snippet,
  };
}

const searchSessions = { createSearchSessionsToolDefinition };

export default searchSessions;
