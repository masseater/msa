import { joinPath, readTextFile, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_COMPACTION_SETTINGS, findCutPoint } from "../src/core/compaction/index.ts";
import {
  buildSessionContext,
  migrateSessionEntries,
  parseSessionEntries,
  type SessionEntry,
  type SessionMessageEntry,
} from "../src/core/session-manager.ts";

const loadLargeSessionEntries: Effect.Effect<SessionEntry[]> = Effect.gen(function* () {
  const sessionPath = joinPath(__dirname, "fixtures/large-session.jsonl");
  const content = yield* readTextFile(sessionPath);
  const entries = parseSessionEntries(content);
  migrateSessionEntries(entries);
  return entries.filter((e): e is SessionEntry => e.type !== "session");
});
describe("Large session fixture", () => {
  it("should parse the large session", () =>
    runTest(
      Effect.gen(function* () {
        const entries = yield* loadLargeSessionEntries;
        expect(entries.length).toBeGreaterThan(100);
        const messageCount = entries.filter((e) => e.type === "message").length;
        expect(messageCount).toBeGreaterThan(100);
      }),
    ));
  it("should find cut point in large session", () =>
    runTest(
      Effect.gen(function* () {
        const entries = yield* loadLargeSessionEntries;
        const result = findCutPoint(
          entries,
          0,
          entries.length,
          DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
        );
        expect(entries[result.firstKeptEntryIndex]?.type).toBe("message");
        const role = (entries[result.firstKeptEntryIndex] as SessionMessageEntry).message.role;
        expect(role === "user" || role === "assistant").toBe(true);
      }),
    ));
  it("should load session correctly", () =>
    runTest(
      Effect.gen(function* () {
        const entries = yield* loadLargeSessionEntries;
        const loaded = buildSessionContext(entries);
        expect(loaded.messages.length).toBeGreaterThan(100);
        expect(loaded.model).not.toBeNull();
      }),
    ));
});
