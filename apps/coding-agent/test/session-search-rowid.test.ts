import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const { joinPath, removeDirs, removePath, runNodeScript, runTest, toJsonText } = testing;
const { currentIndexPath, header, makeLocations, user, writeSession } = fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const BULK_FILES = 300;
const searchModule = new URL("../src/core/session-search/session-search.ts", import.meta.url).href;
const sourceResolver = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const find = (locations: sessionSearchTypes.Locations, query: string) =>
  Effect.promise(() =>
    sessionSearch.searchSessions(locations, { filters: {}, limit: 100, order: "oldest", query }),
  ).pipe(Effect.map(({ hits }) => hits.map((hit) => hit.entryId)));

const refresh = (locations: sessionSearchTypes.Locations) =>
  Effect.promise(() => sessionSearch.refresh(locations));

const entries = (prefix: string, count: number, word: string) =>
  Array.from({ length: count }, (_, index) => user(`${prefix}${index}`, DAY, `${word} ${index}`));

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

const rowidsBeyondNumbers = (indexPath: string): bigint => {
  const database = new DatabaseSync(indexPath, { readBigInts: true });
  const row = database
    .prepare("SELECT count(*) AS n FROM parts_fts_data WHERE rowid > ?")
    .get(MAX_SAFE) as { n: bigint };
  database.close();
  return row.n;
};

const seedTwoSessions = Effect.fn("seedTwoSessions")(function* (
  locations: sessionSearchTypes.Locations,
) {
  const root = locations.roots[0] ?? "";
  const anchor = joinPath(root, "--w--", "anchor.jsonl");
  const target = joinPath(root, "--w--", "target.jsonl");
  yield* writeSession(anchor, [header("a", "/w", DAY), ...entries("a", 8, "anchor")]);
  yield* writeSession(target, [header("t", "/w", DAY), ...entries("t", 8, "target")]);
  return { anchor, target };
});

const reindexesAShortenedFile = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const { target } = yield* seedTwoSessions(locations);
      expect(yield* find(locations, "target")).toEqual(ids("t", 8));
      yield* writeSession(target, [header("t", "/w", DAY), ...entries("t", 2, "target")]);
      expect(yield* refresh(locations)).toMatchObject({ changedFiles: 1, files: 2 });
      expect(yield* find(locations, "target")).toEqual(ids("t", 2));
      expect(rowidsBeyondNumbers(yield* currentIndexPath(locations))).toBeGreaterThan(0n);
      yield* writeSession(target, [header("t", "/w", DAY), ...entries("t", 1, "target")]);
      expect(yield* find(locations, "target")).toEqual(ids("t", 1));
      expect(yield* find(locations, "anchor")).toEqual(ids("a", 8));
    }),
  );

const dropsARemovedFile = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const { anchor, target } = yield* seedTwoSessions(locations);
      expect(yield* find(locations, "target")).toEqual(ids("t", 8));
      yield* removePath(target);
      expect(yield* refresh(locations)).toMatchObject({ changedFiles: 0, removedFiles: 1 });
      expect(yield* find(locations, "target")).toEqual([]);
      expect(rowidsBeyondNumbers(yield* currentIndexPath(locations))).toBeGreaterThan(0n);
      expect(yield* find(locations, "anchor")).toEqual(ids("a", 8));
      yield* writeSession(anchor, [header("a", "/w", DAY), ...entries("a", 3, "anchor")]);
      expect(yield* find(locations, "anchor")).toEqual(ids("a", 3));
    }),
  );

const SEARCH_IN_A_PROCESS = `
const { default: sessionSearch } = await import(process.env.SEARCH_MODULE);
const locations = JSON.parse(process.env.SEARCH_LOCATIONS);
const { changedFiles } = await sessionSearch.refresh(locations);
const { hits } = await sessionSearch.searchSessions(locations, {
  filters: {}, limit: 100, order: "oldest", query: "target",
});
console.log(JSON.stringify({ changedFiles, ids: hits.map((hit) => hit.entryId).join(",") }));
`;

const searchInAProcess = (locationsText: string) =>
  runNodeScript(SEARCH_IN_A_PROCESS, {
    env: { SEARCH_LOCATIONS: locationsText, SEARCH_MODULE: searchModule },
    nodeArgs: ["--import", sourceResolver],
    timeout: "60 seconds",
  });

const updatesFromProcessesAtOnce = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const root = locations.roots[0] ?? "";
      for (const name of ["b", "c", "d", "e"]) {
        yield* writeSession(joinPath(root, "--w--", `${name}.jsonl`), [
          header(name, "/w", DAY),
          ...entries(name, 8, "other"),
        ]);
      }
      for (let file = 0; file < BULK_FILES; file += 1) {
        yield* writeSession(joinPath(root, "--bulk--", `${file}.jsonl`), [
          header(`bulk${file}`, "/w", DAY),
          ...entries(`bulk${file}-`, 40, "bulk ".repeat(200)),
        ]);
      }
      yield* seedTwoSessions(locations);
      const locationsText = yield* toJsonText(locations);
      const results = yield* Effect.all(
        Array.from({ length: 4 }, () => searchInAProcess(locationsText)),
        { concurrency: "unbounded" },
      );
      const outputs = results.map((result) => {
        expect(result.code, result.stderr).toBe(0);
        return JSON.parse(result.stdout) as { changedFiles: number; ids: string };
      });
      for (const output of outputs) expect(output.ids).toBe(ids("t", 8).join(","));
      expect(outputs.map((output) => output.changedFiles).toSorted()).toEqual([
        0,
        0,
        0,
        6 + BULK_FILES,
      ]);
      expect(yield* find(locations, "target")).toEqual(ids("t", 8));
      expect((yield* find(locations, "other")).length).toBe(32);
    }),
  );

describe("search_sessions index with FTS5 rowids beyond JavaScript numbers", () => {
  it("reindexes a shortened file", reindexesAShortenedFile);
  it("drops a removed file", dropsARemovedFile);
  it("updates from several processes at once", updatesFromProcessesAtOnce);
});
