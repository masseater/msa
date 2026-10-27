import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const { joinPath, removeDirs, runNodeScript, runTest, sleep, toJsonText, writeTextFile } = testing;
const { header, makeLocations, seedThreads, user, writeSession } = fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";
const TARGETS = 8;
const OTHER_FILES = 40;
const REBUILDS = 40;
const PAST_THREADS = 3000;
const searchModule = new URL("../src/core/session-search/session-search.ts", import.meta.url).href;
const sourceResolver = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const SEARCH_UNTIL_STOPPED = `
const { existsSync } = await import("node:fs");
const { default: sessionSearch } = await import(process.env.SEARCH_MODULE);
const locations = JSON.parse(process.env.SEARCH_LOCATIONS);
const results = [];
while (!existsSync(process.env.STOP_FILE)) {
  try {
    const hits = await sessionSearch.searchSessions(locations, {
      filters: {}, limit: 100, order: "oldest", query: "target",
    });
    results.push(hits.length);
  } catch (error) {
    results.push(String(error instanceof Error ? error.message : error));
  }
}
console.log(JSON.stringify(results));
`;

const REBUILD_REPEATEDLY = `
const { DatabaseSync } = await import("node:sqlite");
const locations = JSON.parse(process.env.SEARCH_LOCATIONS);
const rebuilds = Number(process.env.REBUILDS);
for (let round = 0; round < rebuilds; round += 1) {
  const database = new DatabaseSync(locations.indexPath, { timeout: 30000 });
  database.exec("PRAGMA user_version = 0");
  database.close();
  const { default: sessionSearch } = await import(process.env.SEARCH_MODULE + "?rebuild=" + round);
  await sessionSearch.refresh(locations);
}
`;

const node = (source: string, env: Record<string, string>) =>
  runNodeScript(source, {
    env: { ...env, SEARCH_MODULE: searchModule },
    nodeArgs: ["--import", sourceResolver],
    timeout: "90 seconds",
  });

const seed = Effect.fn("seed")(function* (locations: sessionSearchTypes.Locations) {
  const directory = joinPath(locations.roots[0] ?? "", "--w--");
  seedThreads(
    locations.orchestratorDatabase,
    Array.from({ length: PAST_THREADS }, (_, index) => ({
      role: "worker" as const,
      round: "r1",
      sessionFile: joinPath(directory, `past-${index}.jsonl`),
      taskId: `task-${index}`,
      threadId: `thread-${index}`,
    })),
  );
  yield* writeSession(joinPath(directory, "target.jsonl"), [
    header("t", "/w", DAY),
    ...Array.from({ length: TARGETS }, (_, index) => user(`t${index}`, DAY, `target ${index}`)),
  ]);
  for (let file = 0; file < OTHER_FILES; file += 1) {
    yield* writeSession(joinPath(directory, `other-${file}.jsonl`), [
      header(`o${file}`, "/w", DAY),
      ...Array.from({ length: 20 }, (_, index) =>
        user(`o${file}-${index}`, DAY, `other entry ${index} `.repeat(20)),
      ),
    ]);
  }
});

const searchesNeverSeeAPartlyRebuiltIndex = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seed(locations);
      const stopFile = joinPath(locations.roots[0] ?? "", "stop");
      const env = { SEARCH_LOCATIONS: yield* toJsonText(locations), STOP_FILE: stopFile };
      expect((yield* node(REBUILD_REPEATEDLY, { ...env, REBUILDS: "1" })).code).toBe(0);
      const rebuildWhileSearching = Effect.gen(function* () {
        yield* sleep("1 second");
        const rebuilt = yield* node(REBUILD_REPEATEDLY, { ...env, REBUILDS: String(REBUILDS) });
        yield* writeTextFile(stopFile, "stop\n");
        return rebuilt;
      });
      const [rebuilt, ...searchers] = yield* Effect.all(
        [
          rebuildWhileSearching,
          ...Array.from({ length: 4 }, () => node(SEARCH_UNTIL_STOPPED, env)),
        ],
        { concurrency: "unbounded" },
      );
      expect(rebuilt?.code, rebuilt?.stderr).toBe(0);
      const results = searchers.flatMap((searcher) => {
        expect(searcher.code, searcher.stderr).toBe(0);
        return JSON.parse(searcher.stdout) as (number | string)[];
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.filter((result) => result !== TARGETS)).toEqual([]);
    }),
  );

describe("search_sessions while another process rebuilds the index", () => {
  it(
    "returns every match, never an empty or partly rebuilt index",
    searchesNeverSeeAPartlyRebuiltIndex,
    120_000,
  );
});
