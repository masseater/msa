import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import indexStore from "../src/core/session-search/index-store.ts";
import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const {
  appendTextFile,
  awaited,
  currentTimeMillis,
  fromJsonText,
  joinPath,
  removeDirs,
  runNodeScript,
  runTest,
  sleep,
  toJsonText,
} = testing;
const { currentIndexPath, header, makeLocations, sessionText, user, writeSession } = fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";
const BULK_FILES = 300;
const BULK_ENTRIES = 40;
const searchModule = new URL("../src/core/session-search/session-search.ts", import.meta.url).href;
const sourceResolver = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const PRELUDE = `
const { appendFileSync, existsSync, readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { DatabaseSync } = await import("node:sqlite");
const locations = JSON.parse(process.env.SEARCH_LOCATIONS);
const directory = join(locations.indexDirectory, process.env.INDEX_VERSION);
const currentIndex = () => join(directory, readFileSync(join(directory, "current"), "utf8").trim());
const instance = async (name) => (await import(process.env.SEARCH_MODULE + "?" + name)).default;
const pause = (millis) => new Promise((resolve) => setTimeout(resolve, millis));
const request = { filters: {}, limit: 100, order: "oldest", query: process.env.QUERY };
`;

const SEARCH_DURING_A_REBUILD = `${PRELUDE}
const searcher = await instance("searcher");
await searcher.refresh(locations);
const stale = new DatabaseSync(currentIndex());
stale.exec("PRAGMA user_version = 0");
stale.close();
const rebuilder = await instance("rebuilder");
let rebuilt = false;
const rebuilding = rebuilder.refresh(locations).then(() => { rebuilt = true; });
while (!existsSync(join(directory, "build.lock"))) await pause(1);
appendFileSync(process.env.APPEND_FILE, process.env.APPEND_TEXT);
const { hits } = await searcher.searchSessions(locations, request);
const rebuiltFirst = rebuilt;
await rebuilding;
console.log(JSON.stringify({ ids: hits.map((hit) => hit.entryId), rebuiltFirst }));
`;

const SEARCH_WHILE_THE_NEWEST_INDEX_IS_REBUILT = `${PRELUDE}
const markStale = () => {
  const stale = new DatabaseSync(currentIndex());
  stale.exec("PRAGMA user_version = 0");
  stale.close();
};
const searcher = await instance("searcher");
await searcher.refresh(locations);
markStale();
await (await instance("first-rebuilder")).refresh(locations);
markStale();
let rebuilt = false;
const rebuilding = (await instance("second-rebuilder")).refresh(locations).then(() => { rebuilt = true; });
while (!existsSync(join(directory, "build.lock"))) await pause(1);
appendFileSync(process.env.APPEND_FILE, process.env.APPEND_TEXT);
const { hits } = await searcher.searchSessions(locations, request);
const rebuiltFirst = rebuilt;
await rebuilding;
console.log(JSON.stringify({ ids: hits.map((hit) => hit.entryId), rebuiltFirst }));
`;

const TWO_PROCESSES_APPEND = `${PRELUDE}
const first = await instance("first");
const second = await instance("second");
await first.refresh(locations);
await second.refresh(locations);
const holder = new DatabaseSync(currentIndex());
holder.exec("BEGIN IMMEDIATE");
appendFileSync(process.env.APPEND_FILE, process.env.APPEND_TEXT);
const one = first.refresh(locations);
await pause(300);
appendFileSync(process.env.APPEND_FILE, process.env.APPEND_MORE);
const two = second.refresh(locations);
await pause(300);
holder.exec("COMMIT");
holder.close();
await Promise.all([one, two]);
const reader = await instance("reader");
const { hits } = await reader.searchSessions(locations, request);
console.log(JSON.stringify(hits.map((hit) => hit.entryId)));
`;

const node = (source: string, env: Record<string, string>) =>
  runNodeScript(source, {
    env: { ...env, INDEX_VERSION: `v${indexStore.SCHEMA_VERSION}`, SEARCH_MODULE: searchModule },
    nodeArgs: ["--import", sourceResolver],
    timeout: "90 seconds",
  });

const targetFile = (locations: sessionSearchTypes.Locations): string =>
  joinPath(locations.roots[0] ?? "", "--w--", "target.jsonl");

const seedTarget = (locations: sessionSearchTypes.Locations) =>
  writeSession(targetFile(locations), [
    header("t", "/w", DAY),
    user("t0", DAY, "target zero"),
    user("t1", DAY, "target one"),
  ]);

const seedBulk = Effect.fn("seedBulk")(function* (locations: sessionSearchTypes.Locations) {
  for (let file = 0; file < BULK_FILES; file += 1) {
    yield* writeSession(joinPath(locations.roots[0] ?? "", "--w--", `bulk-${file}.jsonl`), [
      header(`b${file}`, "/w", DAY),
      ...Array.from({ length: BULK_ENTRIES }, (_, index) =>
        user(`b${file}-${index}`, DAY, `bulk entry ${index} `.repeat(40)),
      ),
    ]);
  }
});

const lineOf = (id: string, text: string) => sessionText([user(id, DAY, text)]);

const searchesTheOldIndexWhileAnotherRebuilds = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedTarget(locations);
      yield* seedBulk(locations);
      const result = yield* node(SEARCH_DURING_A_REBUILD, {
        APPEND_FILE: targetFile(locations),
        APPEND_TEXT: yield* lineOf("t2", "target two"),
        QUERY: "target",
        SEARCH_LOCATIONS: yield* toJsonText(locations),
      });
      expect(result.code, result.stderr).toBe(0);
      expect(yield* fromJsonText(result.stdout)).toEqual({
        ids: ["t0", "t1", "t2"],
        rebuiltFirst: false,
      });
    }),
  );

const answersFromTheIndexItHasWhileTheNewestIsRebuilt = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedTarget(locations);
      yield* seedBulk(locations);
      const result = yield* node(SEARCH_WHILE_THE_NEWEST_INDEX_IS_REBUILT, {
        APPEND_FILE: targetFile(locations),
        APPEND_TEXT: yield* lineOf("t2", "target two"),
        QUERY: "target",
        SEARCH_LOCATIONS: yield* toJsonText(locations),
      });
      expect(result.code, result.stderr).toBe(0);
      expect(yield* fromJsonText(result.stdout)).toEqual({
        ids: ["t0", "t1", "t2"],
        rebuiltFirst: false,
      });
    }),
  );

const indexesLinesTwoProcessesReadOnce = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedTarget(locations);
      const result = yield* node(TWO_PROCESSES_APPEND, {
        APPEND_FILE: targetFile(locations),
        APPEND_MORE: yield* lineOf("t3", "target three"),
        APPEND_TEXT: yield* lineOf("t2", "target two"),
        QUERY: "target",
        SEARCH_LOCATIONS: yield* toJsonText(locations),
      });
      expect(result.code, result.stderr).toBe(0);
      expect(yield* fromJsonText(result.stdout)).toEqual(["t0", "t1", "t2", "t3"]);
    }),
  );

const keepsTheEventLoopRunningWhileTheIndexIsLocked = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedTarget(locations);
      const find = () =>
        sessionSearch
          .searchSessions(locations, { filters: {}, limit: 10, order: "oldest", query: "target" })
          .then(({ hits }) => hits.map((hit) => hit.entryId));
      expect(yield* awaited(find())).toEqual(["t0", "t1"]);
      const holder = new DatabaseSync(yield* currentIndexPath(locations));
      holder.exec("BEGIN IMMEDIATE");
      yield* appendTextFile(targetFile(locations), yield* lineOf("t2", "target two"));
      let done = false;
      const started = currentTimeMillis();
      const searching = find().then((ids) => {
        done = true;
        return ids;
      });
      yield* sleep("300 millis");
      const waited = currentTimeMillis() - started;
      const doneWhileLocked = done;
      holder.exec("COMMIT");
      holder.close();
      expect(yield* awaited(searching)).toEqual(["t0", "t1", "t2"]);
      expect(doneWhileLocked).toBe(false);
      expect(waited).toBeLessThan(2000);
    }),
  );

describe("search_sessions with several processes", () => {
  it(
    "answers from the current index while another process rebuilds it",
    searchesTheOldIndexWhileAnotherRebuilds,
    120_000,
  );
  it(
    "answers from the index it has open while another process rebuilds the newest one",
    answersFromTheIndexItHasWhileTheNewestIsRebuilt,
    120_000,
  );
  it(
    "indexes lines that two processes read at once only once",
    indexesLinesTwoProcessesReadOnce,
    60_000,
  );
  it(
    "keeps the event loop running while another connection holds the index",
    keepsTheEventLoopRunningWhileTheIndexIsLocked,
  );
});
