import testing from "@msa/testing";
import { Effect } from "effect";

import memory from "../../src/core/memory/memory.ts";
import DatabaseSync from "../../src/core/platform/node/sqlite.ts";

const { pathExists, pollUntil } = testing;
const { MEMORY_RECALL_MESSAGE_TYPE } = memory;

const fakeGitHubToken = () => `ghp_${"a".repeat(36)}`;

const longMemorySentences = Array.from(
  { length: 150 },
  (_, index) => `Long note sentence ${index + 1} stays whole.`,
);

const recalls = (messages: readonly unknown[]) =>
  messages.flatMap((message) => {
    const custom = message as {
      role?: string;
      customType?: string;
      display?: boolean;
      content?: unknown;
    };
    return custom.role === "custom" && custom.customType === MEMORY_RECALL_MESSAGE_TYPE
      ? [{ display: custom.display, text: String(custom.content) }]
      : [];
  });

const writeLegacyDatabase = (path: string) => {
  const database = new DatabaseSync(path);
  database.exec(
    `CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL,
      scope TEXT NOT NULL, project TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  );
  const insert = database.prepare(
    "INSERT INTO memories (id, content, kind, scope, project, created_at, updated_at) VALUES (?, ?, 'fact', ?, ?, ?, ?)",
  );
  insert.run("m1", "the release goes to the Homebrew tap", "project", "tap-repo", 1, 1);
  insert.run("m2", "the user writes commit messages in Japanese", "global", null, 2, 2);
  insert.run("m3", `the deploy token is ${fakeGitHubToken()}`, "global", null, 3, 3);
  insert.run("m4", longMemorySentences.join(" "), "global", null, 4, 4);
  database.close();
};

const operationOf = (request: string): "forget" | "recall" | "save" => {
  const [first = ""] = request.trim().split(/(?<=[.?!。？！])\s*/u);
  if (/[?？]$/u.test(first)) return "recall";
  if (/^forget\b|忘れて/iu.test(first)) return "forget";
  if (/^remember\b|覚えて/iu.test(first)) return "save";
  return "recall";
};

const waitForFile = (path: string) =>
  Effect.gen(function* () {
    yield* pollUntil(pathExists(path), 100, "50 millis");
    return yield* pathExists(path);
  });

const sepiaceMemoryFixtures = {
  fakeGitHubToken,
  longMemorySentences,
  operationOf,
  recalls,
  waitForFile,
  writeLegacyDatabase,
};

export default sepiaceMemoryFixtures;
