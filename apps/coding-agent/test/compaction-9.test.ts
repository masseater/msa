import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import sessionContext from "../src/core/session-manager/session-context.ts";
import sessionFormat from "../src/core/session-manager/session-format.ts";

const { buildSessionContext } = sessionContext;
const { migrateSessionEntries, parseSessionEntries } = sessionFormat;
const { DEFAULT_COMPACTION_SETTINGS, findCutPoint } = compaction;

const { joinPath, readTextFile, runTest } = testing;

const loadLargeSessionEntries: Effect.Effect<sessionManagerTypes.SessionEntry[]> = Effect.gen(
  function* () {
    const sessionPath = joinPath(__dirname, "fixtures/large-session.jsonl");
    const content = yield* readTextFile(sessionPath);
    const entries = parseSessionEntries(content);
    migrateSessionEntries(entries);
    return entries.filter((e): e is sessionManagerTypes.SessionEntry => e.type !== "session");
  },
);
const shouldParseTheLargeSession = () =>
  runTest(
    Effect.gen(function* () {
      const entries = yield* loadLargeSessionEntries;
      expect(entries.length).toBeGreaterThan(100);
      const messageCount = entries.filter((e) => e.type === "message").length;
      expect(messageCount).toBeGreaterThan(100);
    }),
  );

const shouldFindCutPointInLargeSession = () =>
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
      const role = (entries[result.firstKeptEntryIndex] as sessionManagerTypes.SessionMessageEntry)
        .message.role;
      expect(role === "user" || role === "assistant").toBe(true);
    }),
  );

const shouldLoadSessionCorrectly = () =>
  runTest(
    Effect.gen(function* () {
      const entries = yield* loadLargeSessionEntries;
      const loaded = buildSessionContext(entries);
      expect(loaded.messages.length).toBeGreaterThan(100);
      expect(loaded.model).not.toBeNull();
    }),
  );

describe("Large session fixture", () => {
  it("should parse the large session", shouldParseTheLargeSession);
  it("should find cut point in large session", shouldFindCutPointInLargeSession);
  it("should load session correctly", shouldLoadSessionCorrectly);
});
