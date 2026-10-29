import type aiTypes from "@msa/ai/index.types";

import type sessionManagerTypes from "../session-manager.types.ts";

declare namespace sessionViewTypes {
  type Entry = sessionManagerTypes.SessionEntry;

  type MessageEntry = Extract<Entry, { type: "message" }>;

  type ToolResult = Extract<aiTypes.Message, { role: "toolResult" }>;

  interface SessionGraph {
    readonly byId: ReadonlyMap<string, Entry>;
    readonly defaultLeaf: string | undefined;
    readonly entries: readonly Entry[];
    readonly newestLeaf: ReadonlyMap<string, string>;
    readonly pathTo: (id: string) => readonly string[];
    readonly toolCalls: ReadonlyMap<string, aiTypes.ToolCall>;
    readonly toolResults: ReadonlyMap<string, ToolResult>;
    readonly viewIndex: ReadonlyMap<string, number>;
    readonly views: readonly string[];
  }

  interface EntryRefs {
    readonly anchorOf: (id: string) => string;
    readonly indexOf: (id: string) => number;
    readonly isNested: (id: string) => boolean;
    readonly leafOf: (id: string) => number;
    readonly pathClassesOf: (id: string) => string;
  }
}

export type { sessionViewTypes as default };
