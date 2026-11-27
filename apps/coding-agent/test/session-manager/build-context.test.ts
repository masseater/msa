import { describe, expect, it } from "vite-plus/test";

import sessionContext from "../../src/core/session-manager/session-context.ts";
import sessionEntrySupport from "./session-entry-support.ts";

const { buildContextEntries, buildSessionContext } = sessionContext;
const { entriesOf } = sessionEntrySupport;

type Row = Parameters<typeof entriesOf>[0][number];

type Leaf = readonly [] | readonly [string];

type Expected = Readonly<{
  count?: number;
  entryIds?: readonly string[];
  model?: Readonly<{ modelId: string; provider: string }> | null;
  roles?: readonly string[];
  texts?: readonly string[];
  thinkingLevel?: string;
}>;

const NO_LEAF: Leaf = [];
const CLAUDE = { modelId: "claude-test", provider: "anthropic-api" };

const textOf = (message: unknown): string => {
  const { summary, content } = message as {
    summary?: string;
    content?: string | readonly { text: string }[];
  };
  return summary ?? (typeof content === "string" ? content : (content?.[0]?.text ?? ""));
};

const CONVERSATION: readonly Row[] = [
  ["user", "1", null, "first"],
  ["assistant", "2", "1", "response1"],
  ["user", "3", "2", "second"],
  ["assistant", "4", "3", "response2"],
];

const FORKED: readonly Row[] = [
  ["user", "1", null, "start"],
  ["assistant", "2", "1", "response"],
  ["user", "3", "2", "branch A"],
  ["user", "4", "2", "branch B"],
];

const COMPLEX: readonly Row[] = [
  ["user", "1", null, "start"],
  ["assistant", "2", "1", "r1"],
  ["user", "3", "2", "q2"],
  ["assistant", "4", "3", "r2"],
  ["compaction", "5", "4", "3", "Compacted history"],
  ["user", "6", "5", "q3"],
  ["assistant", "7", "6", "r3"],
  ["user", "8", "3", "wrong path"],
  ["assistant", "9", "8", "wrong response"],
  ["branch", "10", "3", "9", "Tried wrong approach"],
  ["user", "11", "10", "better approach"],
];

const SCENARIOS: readonly (readonly [string, readonly Row[], Leaf, Expected])[] = [
  [
    "empty entries returns empty context",
    [],
    NO_LEAF,
    { model: null, roles: [], thinkingLevel: "off" },
  ],
  ["single user message", [["user", "1", null, "hello"]], NO_LEAF, { roles: ["user"] }],
  [
    "simple conversation",
    [
      ["user", "1", null, "hello"],
      ["assistant", "2", "1", "hi there"],
      ["user", "3", "2", "how are you"],
      ["assistant", "4", "3", "great"],
    ],
    NO_LEAF,
    { roles: ["user", "assistant", "user", "assistant"] },
  ],
  [
    "tracks thinking level changes",
    [
      ["user", "1", null, "hello"],
      ["thinking", "2", "1", "high"],
      ["assistant", "3", "2", "thinking hard"],
    ],
    NO_LEAF,
    { count: 2, thinkingLevel: "high" },
  ],
  [
    "tracks model from assistant message",
    [
      ["user", "1", null, "hello"],
      ["assistant", "2", "1", "hi"],
    ],
    NO_LEAF,
    { model: CLAUDE },
  ],
  [
    "tracks model from model change entry",
    [
      ["user", "1", null, "hello"],
      ["model", "2", "1", "openai", "gpt-4"],
      ["assistant", "3", "2", "hi"],
    ],
    NO_LEAF,
    { model: CLAUDE },
  ],
  [
    "includes summary before kept messages",
    [
      ...CONVERSATION,
      ["compaction", "5", "4", "3", "Summary of first two turns"],
      ["user", "6", "5", "third"],
      ["assistant", "7", "6", "response3"],
    ],
    NO_LEAF,
    { texts: ["Summary of first two turns", "second", "response2", "third", "response3"] },
  ],
  [
    "handles compaction keeping from first message",
    [
      ["user", "1", null, "first"],
      ["assistant", "2", "1", "response"],
      ["compaction", "3", "2", "1", "Empty summary"],
      ["user", "4", "3", "second"],
    ],
    NO_LEAF,
    { count: 4, texts: ["Empty summary"] },
  ],
  [
    "multiple compactions uses latest",
    [
      ["user", "1", null, "a"],
      ["assistant", "2", "1", "b"],
      ["compaction", "3", "2", "1", "First summary"],
      ["user", "4", "3", "c"],
      ["assistant", "5", "4", "d"],
      ["compaction", "6", "5", "4", "Second summary"],
      ["user", "7", "6", "e"],
    ],
    NO_LEAF,
    { count: 4, texts: ["Second summary"] },
  ],
  [
    "buildContextEntries returns compaction-aware entries including custom entries",
    [
      ["user", "1", null, "first"],
      ["custom", "2", "1", "old-state"],
      ["assistant", "3", "2", "response1"],
      ["custom", "4", "3", "kept-card"],
      ["user", "5", "4", "second"],
      ["compaction", "6", "5", "4", "Summary"],
      ["custom", "7", "6", "after-card"],
      ["assistant", "8", "7", "response2"],
    ],
    NO_LEAF,
    { entryIds: ["6", "4", "5", "7", "8"], roles: ["compactionSummary", "user", "assistant"] },
  ],
  [
    "keeps settings from the full path after compaction",
    [
      ["user", "1", null, "first"],
      ["thinking", "2", "1", "high"],
      ["assistant", "3", "2", "response1"],
      ["user", "4", "3", "second"],
      ["compaction", "5", "4", "4", "Summary"],
    ],
    NO_LEAF,
    { roles: ["compactionSummary", "user"], thinkingLevel: "high" },
  ],
  ["follows path to leaf A", FORKED, ["3"], { count: 3, texts: ["", "", "branch A"] }],
  ["follows path to leaf B", FORKED, ["4"], { count: 3, texts: ["", "", "branch B"] }],
  [
    "includes branch summary in path",
    [
      ["user", "1", null, "start"],
      ["assistant", "2", "1", "response"],
      ["user", "3", "2", "abandoned path"],
      ["branch", "4", "2", "3", "Summary of abandoned work"],
      ["user", "5", "4", "new direction"],
    ],
    ["5"],
    { count: 4, texts: ["", "", "Summary of abandoned work", "new direction"] },
  ],
  [
    "complex tree follows the compacted main path",
    COMPLEX,
    ["7"],
    { texts: ["Compacted history", "q2", "r2", "q3", "r3"] },
  ],
  [
    "complex tree follows the branch with a summary",
    COMPLEX,
    ["11"],
    { texts: ["start", "r1", "q2", "Tried wrong approach", "better approach"] },
  ],
  [
    "uses last entry when leafId not found",
    [
      ["user", "1", null, "hello"],
      ["assistant", "2", "1", "hi"],
    ],
    ["nonexistent"],
    { count: 2 },
  ],
  [
    "handles orphaned entries gracefully",
    [
      ["user", "1", null, "hello"],
      ["assistant", "2", "missing", "orphan"],
    ],
    ["2"],
    { count: 1 },
  ],
];

const ANY = { asymmetricMatch: (): boolean => true };

describe("buildSessionContext", () => {
  for (const [name, rows, leaf, expected] of SCENARIOS) {
    it(name, () => {
      const entries = entriesOf(rows);
      const ctx = buildSessionContext(entries, ...leaf);
      const wanted = expected.texts ?? [];
      expect({
        count: ctx.messages.length,
        entryIds: buildContextEntries(entries).map((entry) => entry.id),
        model: ctx.model,
        roles: ctx.messages.map((message) => message.role),
        texts: ctx.messages.map(textOf),
        thinkingLevel: ctx.thinkingLevel,
      }).toEqual({
        count: expected.count ?? expected.texts?.length ?? ANY,
        entryIds: ANY,
        model: ANY,
        roles: ANY,
        thinkingLevel: ANY,
        ...expected,
        texts: ctx.messages.map((_message, index) => expect.stringContaining(wanted[index] ?? "")),
      });
    });
  }
});
