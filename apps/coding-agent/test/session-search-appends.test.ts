import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import indexStore from "../src/core/session-search/index-store.ts";
import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const { awaited, currentTimeMillis, fromJsonText, joinPath, removeDirs, runNodeScript, runTest } =
  testing;
const { header, indexVersionDirectory, makeLocations, user, writeSession } = fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";
const PROCESSES = 4;
const BULK_FILES = 100;
const SEARCH_MILLIS = 6000;
const searchModule = new URL("../src/core/session-search/session-search.ts", import.meta.url).href;
const sourceResolver = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const APPEND_AND_SEARCH = `
const { appendFileSync } = await import("node:fs");
const locations = JSON.parse(process.env.SEARCH_LOCATIONS);
const search = (await import(process.env.SEARCH_MODULE)).default;
const files = [process.env.OWN_FILE, process.env.SHARED_FILE];
const until = Number(process.env.UNTIL);
const letters = (count) => {
  let text = "";
  do {
    text = String.fromCharCode(97 + (count % 26)) + text;
    count = Math.floor(count / 26);
  } while (count > 0);
  return text;
};
const missed = [];
let searches = 0;
while (Date.now() < until) {
  const word = "probe" + process.env.WORKER + "q" + letters(searches);
  const id = process.env.WORKER + "-" + searches;
  const message = { content: [{ text: word, type: "text" }], role: "user", timestamp: 0 };
  const entry = { id, message, parentId: null, timestamp: process.env.DAY, type: "message" };
  appendFileSync(files[searches % 2], JSON.stringify(entry) + "\\n");
  const request = { filters: {}, limit: 5, order: "relevance", query: word };
  const { hits } = await search.searchSessions(locations, request);
  if (hits.filter((hit) => hit.entryId === id).length !== 1) missed.push(id);
  searches += 1;
}
console.log(JSON.stringify({ missed, searches }));
`;

const WATCH_THE_INDEX = `
const { readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { DatabaseSync } = await import("node:sqlite");
const directory = process.env.INDEX_DIRECTORY;
const until = Number(process.env.UNTIL);
const opened = new Map();
const seen = new Map();
const moves = [];
while (Date.now() < until) {
  const name = readFileSync(join(directory, "current"), "utf8").trim();
  if (!opened.has(name)) opened.set(name, new DatabaseSync(join(directory, name), { readOnly: true }));
  for (const row of opened.get(name).prepare("SELECT path, indexed FROM files").all()) {
    const key = name + " " + row.path;
    if (row.indexed < (seen.get(key) ?? 0)) moves.push([row.path, seen.get(key), row.indexed]);
    seen.set(key, row.indexed);
  }
  await new Promise((resolve) => setTimeout(resolve, 1));
}
console.log(JSON.stringify(moves));
`;

interface Outcome {
  missed: string[];
  searches: number;
}

const sessionFile = (locations: sessionSearchTypes.Locations, name: string): string =>
  joinPath(locations.roots[0] ?? "", "--w--", `${name}.jsonl`);

const seed = Effect.fn("seed")(function* (locations: sessionSearchTypes.Locations) {
  for (let file = 0; file < BULK_FILES; file += 1) {
    yield* writeSession(sessionFile(locations, `bulk-${file}`), [
      header(`b${file}`, "/w", DAY),
      ...Array.from({ length: 20 }, (_, index) =>
        user(`b${file}-${index}`, DAY, `bulk entry ${index} `.repeat(40)),
      ),
    ]);
  }
  yield* writeSession(sessionFile(locations, "shared"), [header("shared", "/w", DAY)]);
  for (let worker = 0; worker < PROCESSES; worker += 1) {
    yield* writeSession(sessionFile(locations, `own-${worker}`), [
      header(`own${worker}`, "/w", DAY),
    ]);
  }
});

const searcher = (locations: sessionSearchTypes.Locations, worker: number, until: number) =>
  Effect.gen(function* () {
    const result = yield* runNodeScript(APPEND_AND_SEARCH, {
      env: {
        DAY,
        INDEX_VERSION: `v${indexStore.SCHEMA_VERSION}`,
        OWN_FILE: sessionFile(locations, `own-${worker}`),
        SEARCH_LOCATIONS: yield* testing.toJsonText(locations),
        SEARCH_MODULE: searchModule,
        SHARED_FILE: sessionFile(locations, "shared"),
        UNTIL: String(until),
        WORKER: `w${worker}`,
      },
      nodeArgs: ["--import", sourceResolver],
      timeout: "60 seconds",
    });
    expect(result.code, result.stderr).toBe(0);
    return (yield* fromJsonText(result.stdout)) as Outcome;
  });

const watcher = (locations: sessionSearchTypes.Locations, until: number) =>
  Effect.gen(function* () {
    const result = yield* runNodeScript(WATCH_THE_INDEX, {
      env: { INDEX_DIRECTORY: indexVersionDirectory(locations), UNTIL: String(until) },
      timeout: "60 seconds",
    });
    expect(result.code, result.stderr).toBe(0);
    return yield* fromJsonText(result.stdout);
  });

const findsWhatEachProcessAppendedRightBeforeItsSearch = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seed(locations);
      yield* awaited(sessionSearch.refresh(locations));
      const until = currentTimeMillis() + SEARCH_MILLIS;
      const [movedBack, outcomes] = yield* Effect.all(
        [
          watcher(locations, until),
          Effect.all(
            Array.from({ length: PROCESSES }, (_, worker) => searcher(locations, worker, until)),
            { concurrency: "unbounded" },
          ),
        ],
        { concurrency: "unbounded" },
      );
      expect(outcomes.every((outcome) => outcome.searches > 10)).toBe(true);
      expect(outcomes.flatMap((outcome) => outcome.missed)).toEqual([]);
      expect(movedBack).toEqual([]);
    }),
  );

describe("search_sessions while several processes append and search", () => {
  it(
    "finds the line each process appended right before its own search",
    findsWhatEachProcessAppendedRightBeforeItsSearch,
    120_000,
  );
});
