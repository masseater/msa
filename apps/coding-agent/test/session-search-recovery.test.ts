import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const {
  appendTextFile,
  changeMode,
  joinPath,
  makeDirectory,
  removeDirs,
  runNodeScript,
  runTest,
  sleep,
  toJsonText,
  writeTextFile,
} = testing;
const { header, makeLocations, user, writeSession } = fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";
const searchModule = new URL("../src/core/session-search/session-search.ts", import.meta.url).href;
const sourceResolver = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const search = (locations: sessionSearchTypes.Locations, query: string) =>
  Effect.promise(() =>
    sessionSearch
      .searchSessions(locations, { filters: {}, limit: 50, order: "oldest", query })
      .then(
        (hits) => ({ ids: hits.map((hit) => hit.entryId) }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      ),
  );

const writeOne = (locations: sessionSearchTypes.Locations, ...texts: string[]) =>
  writeSession(joinPath(locations.roots[0] ?? "", "--w--", "s.jsonl"), [
    header("s", "/w", DAY),
    ...texts.map((text, index) => user(`u${index}`, DAY, text)),
  ]);

const rebuildsAfterAFailedUpdate = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two", "alpha three");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1", "u2"] });
      const other = new DatabaseSync(locations.indexPath);
      other.exec("DROP TABLE parts_fts");
      other.close();
      yield* writeOne(locations, "alpha one");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0"] });
      yield* writeOne(locations, "alpha one", "beta two");
      expect(yield* search(locations, "beta")).toEqual({ ids: ["u1"] });
    }),
  );

const rebuildsWhenATableLosesItsColumns = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      const other = new DatabaseSync(locations.indexPath);
      other.exec("DROP TABLE files; CREATE TABLE files (path TEXT)");
      other.close();
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
    }),
  );

const replacesAnIndexThatIsNotADatabase = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "gamma");
      yield* writeTextFile(locations.indexPath, "not a database\n".repeat(400));
      expect(yield* search(locations, "gamma")).toEqual({ ids: ["u0"] });
    }),
  );

const namesTheIndexItCannotOpen = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "delta");
      yield* makeDirectory(locations.indexPath);
      const result = yield* search(locations, "delta");
      expect(result).toEqual({ error: expect.stringContaining(locations.indexPath) });
    }),
  );

const namesTheIndexInADirectoryItCannotWrite = () =>
  runTest(
    Effect.gen(function* () {
      const base = yield* makeLocations(directories);
      const locked = joinPath(base.roots[0] ?? "", "..", "locked");
      yield* makeDirectory(locked);
      yield* changeMode(locked, 0o500);
      const locations = { ...base, indexPath: joinPath(locked, "session-index.db") };
      yield* writeOne(locations, "delta");
      const result = yield* search(locations, "delta");
      yield* changeMode(locked, 0o700);
      expect(result).toEqual({ error: expect.stringContaining(locations.indexPath) });
    }),
  );

const DEPTH = 30_000;

const deeplyNestedCall = (id: string): string =>
  `{"type":"message","id":"${id}","parentId":null,"timestamp":"${DAY}","message":{"role":"assistant","content":[{"type":"toolCall","id":"call","name":"bash","arguments":${'{"a":'.repeat(DEPTH)}"deep"${"}".repeat(DEPTH)}}],"api":"anthropic-messages","model":"m","provider":"anthropic","stopReason":"toolUse","timestamp":0,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}}}\n`;

const refresh = (locations: sessionSearchTypes.Locations) =>
  Effect.promise(() => sessionSearch.refresh(locations));

const skipsAFileItCannotParse = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      const deep = joinPath(locations.roots[0] ?? "", "--w--", "deep.jsonl");
      yield* writeSession(deep, [header("d", "/w", DAY), user("d0", DAY, "alpha deep")]);
      yield* appendTextFile(deep, deeplyNestedCall("d1"));
      const skipped = [{ path: deep, reason: expect.stringContaining("call stack") }];
      expect(yield* refresh(locations)).toMatchObject({ changedFiles: 1, skipped });
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      expect(yield* refresh(locations)).toMatchObject({ changedFiles: 0, skipped: [] });
      const index = new DatabaseSync(locations.indexPath, { readOnly: true });
      const row = index.prepare("SELECT error FROM files WHERE path = ?").get(deep);
      index.close();
      expect(row).toEqual({ error: expect.stringContaining("call stack") });
      yield* appendTextFile(deep, deeplyNestedCall("d2"));
      expect(yield* refresh(locations)).toMatchObject({ changedFiles: 1, skipped });
      yield* writeSession(deep, [header("d", "/w", DAY), user("d0", DAY, "alpha deep")]);
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1", "d0"] });
    }),
  );

const SEARCH_IN_A_NEW_PROCESS = `
const { default: sessionSearch } = await import(process.env.SEARCH_MODULE);
const hits = await sessionSearch.searchSessions(JSON.parse(process.env.SEARCH_LOCATIONS), {
  filters: {}, limit: 50, order: "oldest", query: "alpha",
});
console.log(hits.map((hit) => hit.entryId).join(","));
`;

const rebuildsAnIndexMissingATableWhenOpened = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      const other = new DatabaseSync(locations.indexPath);
      other.exec("DROP TABLE parts_fts");
      other.close();
      const result = yield* searchInANewProcess(locations);
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("u0,u1");
    }),
  );

const searchInANewProcess = (locations: sessionSearchTypes.Locations) =>
  Effect.gen(function* () {
    return yield* runNodeScript(SEARCH_IN_A_NEW_PROCESS, {
      env: { SEARCH_LOCATIONS: yield* toJsonText(locations), SEARCH_MODULE: searchModule },
      nodeArgs: ["--import", sourceResolver],
      timeout: "60 seconds",
    });
  });

const waitsForALockedIndexInsteadOfReplacingIt = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two");
      expect((yield* searchInANewProcess(locations)).stdout.trim()).toBe("u0,u1");
      const holder = new DatabaseSync(locations.indexPath);
      holder.exec(
        "PRAGMA journal_mode = DELETE; CREATE TABLE kept (x); INSERT INTO kept VALUES (1)",
      );
      holder.exec("BEGIN IMMEDIATE; INSERT INTO kept VALUES (2)");
      const release = sleep("1 second").pipe(
        Effect.andThen(
          Effect.sync(() => {
            holder.exec("COMMIT");
            holder.close();
          }),
        ),
      );
      const [result] = yield* Effect.all([searchInANewProcess(locations), release], {
        concurrency: "unbounded",
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("u0,u1");
      const index = new DatabaseSync(locations.indexPath, { readOnly: true });
      const kept = index.prepare("SELECT count(*) AS n FROM kept").get();
      index.close();
      expect(kept).toEqual({ n: 2 });
    }),
  );

const leavesAnIndexFromANewerMsaAlone = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      const newer = new DatabaseSync(locations.indexPath);
      newer.exec("PRAGMA user_version = 99; DROP TABLE files; CREATE TABLE files (path TEXT)");
      newer.close();
      const fresh = yield* searchInANewProcess(locations);
      expect(fresh.code).not.toBe(0);
      expect(fresh.stderr).toContain(`${locations.indexPath} was written by a newer msa`);
      expect(yield* search(locations, "alpha")).toEqual({
        error: expect.stringContaining("written by a newer msa"),
      });
      const index = new DatabaseSync(locations.indexPath, { readOnly: true });
      const version = index.prepare("PRAGMA user_version").get();
      const columns = index.prepare("PRAGMA table_info(files)").all();
      index.close();
      expect(version).toEqual({ user_version: 99 });
      expect(columns).toHaveLength(1);
    }),
  );

describe("search_sessions index recovery", () => {
  it("rebuilds the index from the sessions when an update fails", rebuildsAfterAFailedUpdate);
  it(
    "rebuilds the index when a table keeps its name but loses its columns",
    rebuildsWhenATableLosesItsColumns,
  );
  it("replaces an index file that is not a database", replacesAnIndexThatIsNotADatabase);
  it(
    "names the index in the error when it can neither open nor replace it",
    namesTheIndexItCannotOpen,
  );
  it(
    "names the index in the error when its directory cannot be written",
    namesTheIndexInADirectoryItCannotWrite,
  );
  it(
    "skips a file it cannot parse, records why, and parses it again only once it changes",
    skipsAFileItCannotParse,
  );
  it(
    "rebuilds an index that lost a table before it was opened",
    rebuildsAnIndexMissingATableWhenOpened,
  );
  it("leaves an index written by a newer msa alone", leavesAnIndexFromANewerMsaAlone);
  it(
    "waits for an index another process holds instead of replacing it",
    waitsForALockedIndexInsteadOfReplacingIt,
  );
});
