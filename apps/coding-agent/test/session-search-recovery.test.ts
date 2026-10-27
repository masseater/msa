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
  removePath,
  runNodeScript,
  runTest,
  sleep,
  toJsonText,
  writeTextFile,
} = testing;
const { currentIndexPath, deeplyNestedCall, header, makeLocations, user, writeSession } = fixture;

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
        ({ hits }) => ({ ids: hits.map((hit) => hit.entryId) }),
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
      const other = new DatabaseSync(yield* currentIndexPath(locations));
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
      const other = new DatabaseSync(yield* currentIndexPath(locations));
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
      expect(yield* search(locations, "gamma")).toEqual({ ids: ["u0"] });
      yield* writeTextFile(yield* currentIndexPath(locations), "not a database\n".repeat(400));
      const fresh = yield* searchInANewProcess(locations);
      expect(fresh.code, fresh.stderr).toBe(0);
      expect(fresh.stdout.trim()).toBe("");
      yield* writeOne(locations, "gamma", "alpha");
      expect(yield* search(locations, "gamma")).toEqual({ ids: ["u0"] });
      expect((yield* searchInANewProcess(locations)).stdout.trim()).toBe("u1");
    }),
  );

const rebuildsWhenTheCurrentIndexCannotBeOpened = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one");
      const first = yield* searchInANewProcess(locations);
      expect(first.stdout.trim()).toBe("u0");
      const indexPath = yield* currentIndexPath(locations);
      yield* removePath(indexPath);
      yield* makeDirectory(indexPath);
      const fresh = yield* searchInANewProcess(locations);
      expect(fresh.code, fresh.stderr).toBe(0);
      expect(fresh.stdout.trim()).toBe("u0");
      expect(yield* currentIndexPath(locations)).not.toBe(indexPath);
    }),
  );

const namesTheIndexItCannotOpen = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "delta");
      yield* writeTextFile(locations.indexDirectory, "not a directory\n");
      const result = yield* search(locations, "delta");
      expect(result).toEqual({ error: expect.stringContaining(locations.indexDirectory) });
    }),
  );

const namesTheIndexInADirectoryItCannotWrite = () =>
  runTest(
    Effect.gen(function* () {
      const base = yield* makeLocations(directories);
      const locked = joinPath(base.roots[0] ?? "", "..", "locked");
      yield* makeDirectory(locked);
      yield* changeMode(locked, 0o500);
      const locations = { ...base, indexDirectory: joinPath(locked, "session-index") };
      yield* writeOne(locations, "delta");
      const result = yield* search(locations, "delta");
      yield* changeMode(locked, 0o700);
      expect(result).toEqual({ error: expect.stringContaining(locations.indexDirectory) });
    }),
  );

const refresh = (locations: sessionSearchTypes.Locations) =>
  Effect.promise(() => sessionSearch.refresh(locations));

const skippedIn = (locations: sessionSearchTypes.Locations, query: string) =>
  Effect.promise(() =>
    sessionSearch.searchSessions(locations, { filters: {}, limit: 50, order: "oldest", query }),
  ).pipe(Effect.map(({ skipped }) => skipped));

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
      expect(yield* skippedIn(locations, "alpha")).toEqual(skipped);
      yield* appendTextFile(deep, deeplyNestedCall("d2"));
      expect(yield* refresh(locations)).toMatchObject({ changedFiles: 1, skipped });
      expect(yield* skippedIn(locations, "nothing-matches")).toEqual(skipped);
      yield* writeSession(deep, [header("d", "/w", DAY), user("d0", DAY, "alpha deep")]);
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1", "d0"] });
      expect(yield* skippedIn(locations, "alpha")).toEqual([]);
    }),
  );

const SEARCH_IN_A_NEW_PROCESS = `
const { default: sessionSearch } = await import(process.env.SEARCH_MODULE);
const { hits } = await sessionSearch.searchSessions(JSON.parse(process.env.SEARCH_LOCATIONS), {
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
      const other = new DatabaseSync(yield* currentIndexPath(locations));
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
      const indexPath = yield* currentIndexPath(locations);
      const holder = new DatabaseSync(indexPath);
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
      const index = new DatabaseSync(indexPath, { readOnly: true });
      const kept = index.prepare("SELECT count(*) AS n FROM kept").get();
      index.close();
      expect(kept).toEqual({ n: 2 });
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
    "rebuilds the index when the current index file cannot be opened",
    rebuildsWhenTheCurrentIndexCannotBeOpened,
  );
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
  it(
    "waits for an index another process holds instead of replacing it",
    waitsForALockedIndexInsteadOfReplacingIt,
  );
});
