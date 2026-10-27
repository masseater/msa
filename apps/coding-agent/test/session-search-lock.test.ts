import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const {
  appendTextFile,
  awaited,
  changeMode,
  joinPath,
  makeDirectory,
  makeSymlink,
  readDirectory,
  readTextFile,
  removeDirs,
  removePath,
  runTest,
  sleep,
  writeTextFile,
} = testing;
const {
  currentIndexPath,
  header,
  indexVersionDirectory,
  makeLocations,
  sessionText,
  user,
  writeSession,
} = fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";
const GONE_PID = 2_147_483_646;

const search = (locations: sessionSearchTypes.Locations, query: string) =>
  Effect.promise(() =>
    sessionSearch
      .searchSessions(locations, { filters: {}, limit: 50, order: "oldest", query })
      .then(
        ({ hits }) => ({ ids: hits.map((hit) => hit.entryId) }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      ),
  );

const request = (query: string): sessionSearchTypes.SearchRequest => ({
  filters: {},
  limit: 50,
  order: "oldest",
  query,
});

const sessionFile = (locations: sessionSearchTypes.Locations, root = locations.roots[0] ?? "") =>
  joinPath(root, "--w--", "s.jsonl");

const writeOne = (locations: sessionSearchTypes.Locations, ...texts: string[]) =>
  writeSession(sessionFile(locations), [
    header("s", "/w", DAY),
    ...texts.map((text, index) => user(`u${index}`, DAY, text)),
  ]);

const leaveLock = Effect.fn("leaveLock")(function* (
  locations: sessionSearchTypes.Locations,
  content: string,
) {
  yield* makeDirectory(indexVersionDirectory(locations));
  yield* writeTextFile(joinPath(indexVersionDirectory(locations), "build.lock"), content);
});

const takesOverALockLeftByAProcessThatIsGone = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one");
      yield* leaveLock(locations, `${GONE_PID}\n`);
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0"] });
    }),
  );

const takesOverALockThatStaysUnreadable = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one");
      yield* leaveLock(locations, "");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0"] });
    }),
  );

const waitsWhenTheLockIsGoneRightAfterItWasTaken = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one");
      const directory = indexVersionDirectory(locations);
      const lock = joinPath(directory, "build.lock");
      yield* makeDirectory(directory);
      yield* makeSymlink(joinPath(directory, "missing"), lock);
      const [result] = yield* Effect.all(
        [search(locations, "alpha"), sleep("300 millis").pipe(Effect.andThen(removePath(lock)))],
        { concurrency: "unbounded" },
      );
      expect(result).toEqual({ ids: ["u0"] });
    }),
  );

const removesTheStagedPointerOfAProcessThatIsGone = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one");
      const directory = indexVersionDirectory(locations);
      yield* makeDirectory(directory);
      yield* writeTextFile(joinPath(directory, `current.${GONE_PID}.tmp`), "stale.db\n");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0"] });
      const name = (yield* readTextFile(joinPath(directory, "current"))).trim();
      const left = (yield* readDirectory(directory)).filter((file) => !file.startsWith(name));
      expect(left).toEqual(["current"]);
    }),
  );

const namesTheIndexWhenItCannotTakeTheLock = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one");
      yield* makeDirectory(indexVersionDirectory(locations));
      yield* changeMode(indexVersionDirectory(locations), 0o500);
      const result = yield* search(locations, "alpha");
      yield* changeMode(indexVersionDirectory(locations), 0o700);
      expect(result).toEqual({ error: expect.stringContaining(locations.indexDirectory) });
    }),
  );

const keepsOnlyTheCurrentGeneration = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      const first = yield* currentIndexPath(locations);
      const broken = new DatabaseSync(first);
      broken.exec("DROP TABLE parts_fts");
      broken.close();
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      const second = yield* currentIndexPath(locations);
      expect(second).not.toBe(first);
      const directory = indexVersionDirectory(locations);
      const name = (yield* readTextFile(joinPath(directory, "current"))).trim();
      const left = (yield* readDirectory(directory)).filter((file) => !file.startsWith(name));
      expect(left).toEqual(["current"]);
    }),
  );

const rebuildsWhenTheIndexStaysLocked = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0"] });
      const indexPath = yield* currentIndexPath(locations);
      const holder = new DatabaseSync(indexPath);
      holder.exec("BEGIN IMMEDIATE");
      yield* appendTextFile(
        sessionFile(locations),
        yield* sessionText([user("u1", DAY, "alpha two")]),
      );
      const result = yield* search(locations, "alpha");
      holder.exec("ROLLBACK");
      holder.close();
      expect(result).toEqual({ ids: ["u0", "u1"] });
      expect(yield* currentIndexPath(locations)).not.toBe(indexPath);
    }),
  );

const keepsTheSessionsOfOtherRoots = () =>
  runTest(
    Effect.gen(function* () {
      const mine = yield* makeLocations(directories);
      const otherRoot = joinPath(mine.roots[0] ?? "", "..", "elsewhere");
      const theirs = { ...mine, roots: [otherRoot] };
      yield* writeOne(mine, "alpha mine");
      yield* writeSession(sessionFile(theirs, otherRoot), [
        header("o", "/o", DAY),
        user("o0", DAY, "alpha theirs"),
      ]);
      expect(yield* search(theirs, "alpha")).toEqual({ ids: ["o0"] });
      expect(yield* search(mine, "alpha")).toEqual({ ids: expect.arrayContaining(["u0", "o0"]) });
      expect(yield* search(mine, "mine")).toEqual({ ids: ["u0"] });
      expect(yield* search(mine, "theirs")).toEqual({ ids: ["o0"] });
      expect(yield* awaited(sessionSearch.refresh(theirs))).toMatchObject({
        changedFiles: 0,
        removedFiles: 0,
      });
    }),
  );

const dropsSessionsOfOtherRootsOnceTheyAreGone = () =>
  runTest(
    Effect.gen(function* () {
      const mine = yield* makeLocations(directories);
      const otherRoot = joinPath(mine.roots[0] ?? "", "..", "elsewhere");
      const theirs = { ...mine, roots: [otherRoot] };
      const gone = sessionFile(theirs, otherRoot);
      const rewritten = joinPath(otherRoot, "--w--", "r.jsonl");
      const deep = joinPath(otherRoot, "--w--", "deep.jsonl");
      const unread = joinPath(otherRoot, "--w--", "unread.jsonl");
      yield* writeOne(mine, "alpha mine");
      yield* writeSession(gone, [header("o", "/o", DAY), user("o0", DAY, "alpha theirs")]);
      yield* writeSession(rewritten, [
        header("r", "/o", DAY),
        user("r0", DAY, `alpha before ${"words that make the file long ".repeat(40)}`),
      ]);
      yield* writeSession(unread, [header("n", "/o", DAY), user("n0", DAY, "zeta")]);
      yield* writeTextFile(
        deep,
        `${yield* sessionText([header("d", "/o", DAY)])}${fixture.deeplyNestedCall("d0")}`,
      );
      expect(yield* search(theirs, "alpha")).toEqual({ ids: expect.arrayContaining(["r0", "o0"]) });
      const readUnread = () =>
        awaited(
          sessionSearch.readSession(mine, {
            after: 1,
            before: 0,
            entry: "n0",
            from: 0,
            path: unread,
          }),
        );
      expect(yield* readUnread()).toMatchObject({ text: expect.stringContaining("zeta") });
      yield* removePath(unread);
      expect(yield* readUnread()).toBeUndefined();
      yield* removePath(gone);
      yield* removePath(deep);
      yield* writeSession(rewritten, [header("r", "/o", DAY), user("r1", DAY, "after")]);
      const found = yield* awaited(sessionSearch.searchSessions(mine, request("alpha")));
      expect(found.hits.map((hit) => hit.entryId)).toEqual(["u0"]);
      expect(found.skipped).toEqual([]);
      expect(yield* search(mine, "theirs")).toEqual({ ids: [] });
      expect(yield* search(mine, "before")).toEqual({ ids: [] });
    }),
  );

describe("search_sessions index lock and files", () => {
  it(
    "takes over a build lock left by a process that is gone",
    takesOverALockLeftByAProcessThatIsGone,
  );
  it("takes over a build lock that stays unreadable", takesOverALockThatStaysUnreadable, 20_000);
  it(
    "waits when the build lock is gone right after another process held it",
    waitsWhenTheLockIsGoneRightAfterItWasTaken,
  );
  it(
    "removes the staged pointer a process that is gone left behind",
    removesTheStagedPointerOfAProcessThatIsGone,
  );
  it("names the index when it cannot take the build lock", namesTheIndexWhenItCannotTakeTheLock);
  it("keeps only the current generation after a rebuild", keepsOnlyTheCurrentGeneration);
  it(
    "builds a new index when another connection keeps the current one locked",
    rebuildsWhenTheIndexStaysLocked,
    30_000,
  );
  it("keeps the sessions of roots another process searches", keepsTheSessionsOfOtherRoots);
  it(
    "drops sessions of other roots that are gone or rewritten before showing them",
    dropsSessionsOfOtherRootsOnceTheyAreGone,
  );
});
