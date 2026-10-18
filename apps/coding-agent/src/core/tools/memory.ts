import { Effect } from "effect";
import { type Static, Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import {
  formatMemoryList,
  formatSearchResults,
  isMemoryKind,
  type MemoryService,
} from "../memory/memory.ts";
import { MEMORY_KINDS } from "../memory/store.ts";
import {
  type ForeignError,
  fromPromise,
  platformRuntime,
  ToolFailure,
  unwrapForeign,
} from "../platform/index.ts";

const memorySchema = Type.Object({
  action: Type.Union(
    [Type.Literal("save"), Type.Literal("search"), Type.Literal("list"), Type.Literal("forget")],
    {
      description:
        "save: store a durable fact; search: find memories by meaning and keywords; list: newest memories; forget: delete one memory by id",
    },
  ),
  content: Type.Optional(
    Type.String({ description: "The memory text (action: save). One durable fact per memory." }),
  ),
  query: Type.Optional(Type.String({ description: "What to look for (action: search)" })),
  id: Type.Optional(Type.String({ description: "Memory id to delete (action: forget)" })),
  kind: Type.Optional(
    Type.String({
      description: `Memory kind: ${MEMORY_KINDS.join(", ")} (action: save, default fact)`,
    }),
  ),
  scope: Type.Optional(
    Type.String({
      description:
        "project (default): only this repository; global: every project, for user preferences",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum results (actions: search, list; default 5)" }),
  ),
});

export type MemoryToolInput = Static<typeof memorySchema>;

export const memoryToolSystemPromptContribution = {
  snippet: "Save, search, list, and forget long-term memories across sessions",
  guidelines: [
    "Use the memory tool to save durable facts, user preferences, and decisions that future sessions need; do not save transient details",
  ],
} as const;

type MemoryParams = Static<typeof memorySchema>;

interface MemoryToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

const textResult = (text: string, details: Record<string, unknown>): MemoryToolResult => ({
  content: [{ type: "text", text }],
  details,
});

const requireText = Effect.fn("requireText")(function* (
  value: string | undefined,
  action: string,
  field: string,
) {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    return yield* new ToolFailure({ message: `action ${action} requires ${field}` });
  }
  return trimmed;
});

const parseKind = Effect.fn("parseKind")(function* (raw: string | undefined) {
  const rawKind = raw?.trim();
  if (rawKind === undefined || rawKind === "") return undefined;
  if (!isMemoryKind(rawKind)) {
    return yield* new ToolFailure({
      message: `Unknown memory kind "${rawKind}"; use one of ${MEMORY_KINDS.join(", ")}`,
    });
  }
  return rawKind;
});

const parseScope = Effect.fn("parseScope")(function* (raw: string | undefined) {
  const rawScope = raw?.trim();
  if (rawScope === undefined || rawScope === "") return undefined;
  if (rawScope !== "project" && rawScope !== "global") {
    return yield* new ToolFailure({
      message: `Unknown memory scope "${rawScope}"; use project or global`,
    });
  }
  return rawScope;
});

const saveMemory = Effect.fn("memorySave")(function* (
  service: MemoryService,
  params: MemoryParams,
) {
  const content = yield* requireText(params.content, "save", "content");
  const kind = yield* parseKind(params.kind);
  const scope = yield* parseScope(params.scope);
  const outcome = yield* fromPromise(() =>
    service.save({
      content,
      ...(kind === undefined ? {} : { kind }),
      ...(scope === undefined ? {} : { scope }),
    }),
  );
  const { record } = outcome;
  const where = record.scope === "global" ? "global" : `project:${record.project}`;
  const lines = [
    outcome.created
      ? `Saved memory ${record.id} (${record.kind}, ${where}).`
      : `Updated memory ${record.id} (${record.kind}).`,
  ];
  if (!outcome.embedded) {
    const reason =
      outcome.embeddingError !== undefined && outcome.embeddingError !== ""
        ? `: ${outcome.embeddingError}`
        : "";
    lines.push(`Saved without an embedding${reason}; it stays searchable by keyword.`);
  }
  return textResult(lines.join("\n"), {
    action: "save",
    id: record.id,
    created: outcome.created,
    embedded: outcome.embedded,
  });
});

const searchMemory = Effect.fn("memorySearch")(function* (
  service: MemoryService,
  params: MemoryParams,
) {
  const query = yield* requireText(params.query, "search", "query");
  const scores = yield* fromPromise(() => service.search(query, params.limit ?? 5));
  return textResult(formatSearchResults(scores), { action: "search", query, count: scores.length });
});

const forgetMemory = Effect.fn("memoryForget")(function* (
  service: MemoryService,
  params: MemoryParams,
) {
  const id = yield* requireText(params.id, "forget", "id");
  const forgotten = service.forget(id);
  return textResult(forgotten ? `Forgot memory ${id}.` : `No memory with id ${id}.`, {
    action: "forget",
    id,
    forgotten,
  });
});

const listMemory = (service: MemoryService, params: MemoryParams) =>
  Effect.sync(() => {
    const records = service.list(params.limit ?? 20);
    return textResult(formatMemoryList(records), { action: "list", count: records.length });
  });

const runMemoryAction = (
  service: MemoryService,
  params: MemoryParams,
): Effect.Effect<MemoryToolResult, ForeignError | ToolFailure> => {
  switch (params.action) {
    case "save":
      return saveMemory(service, params);
    case "search":
      return searchMemory(service, params);
    case "list":
      return listMemory(service, params);
    case "forget":
      return forgetMemory(service, params);
  }
};

export function createMemoryToolDefinition(
  service: MemoryService,
): ToolDefinition<typeof memorySchema, Record<string, unknown> | undefined> {
  return {
    name: "memory",
    label: "memory",
    description:
      "Long-term memory shared across sessions. Save durable facts, user preferences, and decisions (one per memory); search before assuming something was never decided; forget memories the user wants removed. Memories are scoped to this project by default, or global for user-level preferences.",
    promptSnippet: memoryToolSystemPromptContribution.snippet,
    promptGuidelines: [...memoryToolSystemPromptContribution.guidelines],
    parameters: memorySchema,
    execute: (_toolCallId, params) =>
      platformRuntime.runPromise(unwrapForeign(runMemoryAction(service, params))),
  };
}
