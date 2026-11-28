import type sessionManagerTypes from "../../src/core/session-manager.types.ts";

const TIMESTAMP = "2025-01-01T00:00:00Z";
const USAGE = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 1,
  output: 1,
  totalTokens: 2,
};

type Link = Readonly<{ id: string; parentId: string | null }>;

const ENTRY_OF = {
  assistant: (link: Link, [text = ""]: readonly string[]): sessionManagerTypes.SessionEntry => ({
    ...link,
    message: {
      api: "anthropic-messages",
      content: [{ text, type: "text" }],
      model: "claude-test",
      provider: "anthropic-api",
      role: "assistant",
      stopReason: "stop",
      timestamp: 1,
      usage: USAGE,
    },
    timestamp: TIMESTAMP,
    type: "message",
  }),
  branch: (link: Link, [fromId = "", summary = ""]: readonly string[]) => ({
    ...link,
    fromId,
    summary,
    timestamp: TIMESTAMP,
    type: "branch_summary" as const,
  }),
  compaction: (link: Link, [firstKeptEntryId = "", summary = ""]: readonly string[]) => ({
    ...link,
    firstKeptEntryId,
    summary,
    timestamp: TIMESTAMP,
    tokensBefore: 1000,
    type: "compaction" as const,
  }),
  custom: (link: Link, [customType = ""]: readonly string[]) => ({
    ...link,
    customType,
    data: { customType },
    timestamp: TIMESTAMP,
    type: "custom" as const,
  }),
  model: (link: Link, [provider = "", modelId = ""]: readonly string[]) => ({
    ...link,
    modelId,
    provider,
    timestamp: TIMESTAMP,
    type: "model_change" as const,
  }),
  thinking: (link: Link, [thinkingLevel = ""]: readonly string[]) => ({
    ...link,
    thinkingLevel,
    timestamp: TIMESTAMP,
    type: "thinking_level_change" as const,
  }),
  user: (link: Link, [text = ""]: readonly string[]): sessionManagerTypes.SessionEntry => ({
    ...link,
    message: { content: text, role: "user", timestamp: 1 },
    timestamp: TIMESTAMP,
    type: "message",
  }),
} as const;

type Row = readonly [kind: keyof typeof ENTRY_OF, id: string, parentId: string | null, ...string[]];

const entriesOf = (rows: readonly Row[]): sessionManagerTypes.SessionEntry[] =>
  rows.map(([kind, id, parentId, ...fields]) => ENTRY_OF[kind]({ id, parentId }, fields));

export default { entriesOf };
