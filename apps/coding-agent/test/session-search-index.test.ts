import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import SessionManager from "../src/core/session-manager.ts";
import indexStore from "../src/core/session-search/index-store.ts";
import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const { appendTextFile, joinPath, removeDirs, removePath, runTest } = testing;
const { assistant, header, makeLocations, sessionText, toolCall, toolResult, user, writeSession } =
  fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";

const find = (locations: sessionSearchTypes.Locations, query: string) =>
  Effect.promise(() =>
    sessionSearch.searchSessions(locations, { filters: {}, limit: 50, order: "oldest", query }),
  ).pipe(Effect.map((hits) => hits.map((hit) => hit.entryId)));

const indexesAppendedLinesOnceTheyEnd = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const path = joinPath(locations.roots[0] ?? "", "--w--", "s.jsonl");
      yield* writeSession(path, [header("s", "/w", DAY), user("first", DAY, "alpha words")]);
      yield* writeSession(`${path}.bak`, [header("b", "/w", DAY), user("copy", DAY, "alpha")]);
      expect(yield* find(locations, "alpha")).toEqual(["first"]);
      const next = yield* sessionText([user("second", DAY, "alpha again")]);
      yield* appendTextFile(path, next.slice(0, -1));
      expect(yield* find(locations, "alpha")).toEqual(["first"]);
      yield* appendTextFile(path, "\n");
      expect(yield* find(locations, "alpha")).toEqual(["first", "second"]);
      yield* writeSession(path, [
        header("s", "/w", DAY),
        user("other", DAY, `beta ${"words that make the file longer than before ".repeat(40)}`),
        user("more", DAY, "gamma"),
      ]);
      expect(yield* find(locations, "alpha")).toEqual([]);
      expect(yield* find(locations, "beta")).toEqual(["other"]);
      yield* writeSession(path, [header("s", "/w", DAY), user("short", DAY, "beta")]);
      expect(yield* find(locations, "beta")).toEqual(["short"]);
      yield* removePath(path);
      expect(yield* find(locations, "beta")).toEqual([]);
    }),
  );

const findsWhatSessionmanagerWritesIncludingMessages = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const manager = SessionManager.create("/w", joinPath(locations.roots[0] ?? "", "--w--"));
      manager.appendMessage({ content: "継承をやめる", role: "user", timestamp: 1 });
      manager.appendMessage({
        api: "anthropic-messages",
        content: [{ text: "了解", type: "text" }],
        model: "m",
        provider: "anthropic",
        role: "assistant",
        stopReason: "stop",
        timestamp: 2,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      });
      expect((yield* find(locations, "継承")).length).toBe(1);
      manager.appendMessage({ content: "委譲で組む", role: "user", timestamp: 3 });
      expect((yield* find(locations, "委譲")).length).toBe(1);
    }),
  );

const readsOnFromAnEntryA = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const big = `${"x".repeat(60_000)} end-of-output`;
      const path = yield* writeSession(joinPath(locations.roots[0] ?? "", "--w--", "s.jsonl"), [
        header("s", "/w", DAY),
        user("ask", DAY, "run the suite"),
        assistant("call", DAY, [toolCall("c", "bash", { command: "vp test run" })]),
        toolResult("out", DAY, "bash", big),
        user("after", DAY, "next step"),
      ]);
      const read = (entry: string, from: number) =>
        Effect.promise(() =>
          sessionSearch.readSession(locations, { after: 3, before: 0, entry, from, path }),
        );
      const first = yield* read("call", 0);
      expect(first?.text).toContain("vp test run");
      expect(first?.text).not.toContain("end-of-output");
      expect(first?.next?.entry).toBe("out");
      const second = yield* read(first?.next?.entry ?? "", first?.next?.from ?? 0);
      expect(second?.text).toContain("end-of-output");
      expect(second?.text).toContain("next step");
      expect(second?.next).toBeUndefined();
      const around = yield* Effect.promise(() =>
        sessionSearch.readSession(locations, {
          after: 0,
          before: 1,
          entry: "call",
          from: 0,
          path,
        }),
      );
      expect(around?.text).toContain("run the suite");
      expect(around?.text).toContain("vp test run");
      expect(around?.text).not.toContain("end-of-output");
      expect(yield* read("missing", 0)).toBeUndefined();
    }),
  );

const rebuildsAnIndexWrittenByAnother = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const old = new DatabaseSync(locations.indexPath);
      old.exec("CREATE TABLE files (path TEXT); PRAGMA user_version = 99;");
      old.close();
      const database = indexStore.openIndex(locations.indexPath);
      const columns = database.prepare("PRAGMA table_info(files)").all() as { name: string }[];
      database.close();
      expect(columns.map((column) => column.name)).toContain("indexed");
      yield* writeSession(joinPath(locations.roots[0] ?? "", "--w--", "s.jsonl"), [
        header("s", "/w", DAY),
        user("u", DAY, "delta"),
      ]);
      expect(yield* find(locations, "delta")).toEqual(["u"]);
    }),
  );

describe("search_sessions index", () => {
  it(
    "indexes appended lines once they end, and reindexes a rewritten or removed file",
    indexesAppendedLinesOnceTheyEnd,
  );
  it(
    "finds what SessionManager writes, including messages appended later",
    findsWhatSessionmanagerWritesIncludingMessages,
  );
  it("reads on from an entry a search returned, page by page", readsOnFromAnEntryA);
  it("rebuilds an index written by another schema", rebuildsAnIndexWrittenByAnother);
});
