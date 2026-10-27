import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import indexStore from "../src/core/session-search/index-store.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const {
  fromJsonText,
  joinPath,
  removeDir,
  removeDirs,
  runNodeScript,
  runTest,
  sleep,
  toJsonText,
  writeTextFile,
} = testing;
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
const { appendFileSync, existsSync } = await import("node:fs");
const { join } = await import("node:path");
const { default: sessionSearch } = await import(process.env.SEARCH_MODULE);
const locations = JSON.parse(process.env.SEARCH_LOCATIONS);
const written = join(locations.roots[0], "--w--", "written-" + process.pid + ".jsonl");
const line = (id, text) => JSON.stringify({
  type: "message", id, parentId: null, timestamp: "2026-10-01T12:00:00.000Z",
  message: { role: "user", content: [{ type: "text", text }], timestamp: 0 },
}) + "\\n";
appendFileSync(written, JSON.stringify({ type: "session", version: 3, id: "w" + process.pid, timestamp: "2026-10-01T12:00:00.000Z", cwd: "/w" }) + "\\n");
const results = [];
let appended = 0;
while (!existsSync(process.env.STOP_FILE)) {
  appended += 1;
  appendFileSync(written, line("w" + process.pid + "-" + appended, "written " + appended));
  try {
    const { hits } = await sessionSearch.searchSessions(locations, {
      filters: {}, limit: 100, order: "oldest", query: "target",
    });
    results.push(hits.length);
  } catch (error) {
    results.push(String(error instanceof Error ? error.message : error));
  }
}
console.log(JSON.stringify(results));
`;

const COUNT_PER_FILE = `
const { default: sessionSearch } = await import(process.env.SEARCH_MODULE);
const { DatabaseSync } = await import("node:sqlite");
const { readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const locations = JSON.parse(process.env.SEARCH_LOCATIONS);
await sessionSearch.refresh(locations);
const directory = join(locations.indexDirectory, process.env.INDEX_VERSION);
const index = new DatabaseSync(join(directory, readFileSync(join(directory, "current"), "utf8").trim()), { readOnly: true });
const counts = index.prepare("SELECT f.path, count(p.id) AS n, count(DISTINCT p.offset || ':' || p.part) AS d FROM files f LEFT JOIN parts p ON p.file_id = f.id GROUP BY f.path ORDER BY f.path").all();
index.close();
console.log(JSON.stringify(counts));
`;

const REBUILD_REPEATEDLY = `
const { DatabaseSync } = await import("node:sqlite");
const { existsSync, readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const locations = JSON.parse(process.env.SEARCH_LOCATIONS);
const rebuilds = Number(process.env.REBUILDS);
const directory = join(locations.indexDirectory, process.env.INDEX_VERSION);
for (let round = 0; round < rebuilds; round += 1) {
  const pointer = join(directory, "current");
  if (existsSync(pointer)) {
    const database = new DatabaseSync(join(directory, readFileSync(pointer, "utf8").trim()), { timeout: 30000 });
    database.exec("PRAGMA user_version = 0");
    database.close();
  }
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
      const env = {
        INDEX_VERSION: `v${indexStore.SCHEMA_VERSION}`,
        SEARCH_LOCATIONS: yield* toJsonText(locations),
        STOP_FILE: stopFile,
      };
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
      const kept = yield* node(COUNT_PER_FILE, env);
      expect(kept.code, kept.stderr).toBe(0);
      yield* removeDir(locations.indexDirectory);
      const fresh = yield* node(COUNT_PER_FILE, env);
      expect(fresh.code, fresh.stderr).toBe(0);
      const counts = (yield* fromJsonText(kept.stdout)) as { path: string; n: number; d: number }[];
      expect(counts.filter((row) => row.n !== row.d)).toEqual([]);
      expect(counts).toEqual(yield* fromJsonText(fresh.stdout));
    }),
  );

describe("search_sessions while another process rebuilds the index", () => {
  it(
    "returns every match while other processes append, and ends with the index a fresh build makes",
    searchesNeverSeeAPartlyRebuiltIndex,
    120_000,
  );
});
