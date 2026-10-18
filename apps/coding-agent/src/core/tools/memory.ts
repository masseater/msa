import { type Static, Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import {
  formatMemoryList,
  formatSearchResults,
  isMemoryKind,
  type MemoryService,
} from "../memory/memory.ts";
import { MEMORY_KINDS, type MemoryKind, type MemoryScope } from "../memory/store.ts";

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
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      switch (params.action) {
        case "save": {
          const content = params.content?.trim();
          if (!content) throw new Error("action save requires content");
          let kind: MemoryKind | undefined;
          const rawKind = params.kind?.trim();
          if (rawKind) {
            if (!isMemoryKind(rawKind)) {
              throw new Error(
                `Unknown memory kind "${rawKind}"; use one of ${MEMORY_KINDS.join(", ")}`,
              );
            }
            kind = rawKind;
          }
          let scope: MemoryScope | undefined;
          const rawScope = params.scope?.trim();
          if (rawScope) {
            if (rawScope !== "project" && rawScope !== "global") {
              throw new Error(`Unknown memory scope "${rawScope}"; use project or global`);
            }
            scope = rawScope;
          }
          const outcome = await service.save({
            content,
            ...(kind ? { kind } : {}),
            ...(scope ? { scope } : {}),
          });
          const lines = [
            outcome.created
              ? `Saved memory ${outcome.record.id} (${outcome.record.kind}, ${outcome.record.scope === "global" ? "global" : `project:${outcome.record.project}`}).`
              : `Updated memory ${outcome.record.id} (${outcome.record.kind}).`,
          ];
          if (!outcome.embedded) {
            lines.push(
              `Saved without an embedding${outcome.embeddingError ? `: ${outcome.embeddingError}` : ""}; it stays searchable by keyword.`,
            );
          }
          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: {
              action: "save",
              id: outcome.record.id,
              created: outcome.created,
              embedded: outcome.embedded,
            },
          };
        }
        case "search": {
          const query = params.query?.trim();
          if (!query) throw new Error("action search requires query");
          const scores = await service.search(query, params.limit ?? 5);
          return {
            content: [{ type: "text", text: formatSearchResults(scores) }],
            details: { action: "search", query, count: scores.length },
          };
        }
        case "list": {
          const records = service.list(params.limit ?? 20);
          return {
            content: [{ type: "text", text: formatMemoryList(records) }],
            details: { action: "list", count: records.length },
          };
        }
        case "forget": {
          const id = params.id?.trim();
          if (!id) throw new Error("action forget requires id");
          const forgotten = service.forget(id);
          return {
            content: [
              {
                type: "text",
                text: forgotten ? `Forgot memory ${id}.` : `No memory with id ${id}.`,
              },
            ],
            details: { action: "forget", id, forgotten },
          };
        }
      }
    },
  };
}
