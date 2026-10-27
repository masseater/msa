import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import searchSessionsTool from "../src/core/tools/search-sessions.ts";
import fixture from "./session-search-fixture.ts";

const { joinPath, removeDirs, runTest } = testing;
const { assistant, header, makeLocations, seedThreads, toolCall, toolResult, user, writeSession } =
  fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const FIRST = "2026-10-01T12:00:00.000Z";
const THIRD = "2026-10-03T12:00:00.000Z";

const seed = Effect.fn("seed")(function* (locations: sessionSearchTypes.Locations) {
  const root = locations.roots[0] ?? "";
  yield* writeSession(joinPath(root, "--work-app--", "plain.jsonl"), [
    header("plain", "/work/app", FIRST),
    user("plain-user", FIRST, "release checklist"),
  ]);
  yield* writeSession(joinPath(root, "--work-app--", "orchestrator.jsonl"), [
    header("orch", "/work/app", FIRST),
    user("orch-user", FIRST, "release checklist"),
    assistant("orch-call", FIRST, [toolCall("c1", "create_task", { title: "write the parser" })]),
  ]);
  const worker = yield* writeSession(joinPath(root, "--work-app--", "workers", "worker.jsonl"), [
    header("worker", "/work/app-t1", THIRD),
    user("worker-user", THIRD, "release checklist"),
    toolResult("worker-result", THIRD, "bash", "release checklist passed"),
  ]);
  const reviewer = yield* writeSession(
    joinPath(root, "--work-app--", "workers", "reviewer.jsonl"),
    [header("reviewer", "/work/app-t1", THIRD), user("reviewer-user", THIRD, "release checklist")],
  );
  const triage = yield* writeSession(joinPath(root, "--work-app--", "workers", "triage.jsonl"), [
    header("triage", "/work/app-t2", THIRD),
    user("triage-user", THIRD, "release checklist"),
  ]);
  seedThreads(locations.orchestratorDatabase, [
    { role: "worker", round: "r-1", sessionFile: worker, taskId: "t-1", threadId: "th-w" },
    { role: "reviewer", round: "r-1", sessionFile: reviewer, taskId: "t-1", threadId: "th-r" },
    { role: "triage", round: "r-2", sessionFile: triage, taskId: "t-2", threadId: "th-t" },
  ]);
  return worker;
});

const entries = (locations: sessionSearchTypes.Locations, filters: sessionSearchTypes.Filters) =>
  Effect.promise(() =>
    sessionSearch.searchSessions(locations, {
      filters,
      limit: 50,
      order: "oldest",
      query: "release checklist",
    }),
  ).pipe(Effect.map((hits) => hits.map((hit) => hit.entryId ?? "").toSorted()));

const toolText = (locations: sessionSearchTypes.Locations, input: Record<string, unknown>) =>
  Effect.promise(() =>
    searchSessionsTool
      .createSearchSessionsToolDefinition(locations)
      .execute("call", input as never, undefined, undefined, undefined as never),
  ).pipe(
    Effect.map((result) =>
      result.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
    ),
  );

const tellsOrchestratorWorkerReviewerTriageAnd = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seed(locations);
      expect(yield* entries(locations, { roles: ["orchestrator"] })).toEqual(["orch-user"]);
      expect(yield* entries(locations, { roles: ["worker"] })).toEqual([
        "worker-result",
        "worker-user",
      ]);
      expect(yield* entries(locations, { roles: ["reviewer"] })).toEqual(["reviewer-user"]);
      expect(yield* entries(locations, { roles: ["triage"] })).toEqual(["triage-user"]);
      expect(yield* entries(locations, { roles: ["session"] })).toEqual(["plain-user"]);
    }),
  );

const narrowsToTasksThreadsAndRounds = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seed(locations);
      expect(yield* entries(locations, { taskIds: ["t-1"] })).toEqual([
        "reviewer-user",
        "worker-result",
        "worker-user",
      ]);
      expect(yield* entries(locations, { threadIds: ["th-r"] })).toEqual(["reviewer-user"]);
      expect(yield* entries(locations, { rounds: ["r-2"] })).toEqual(["triage-user"]);
      expect(yield* entries(locations, { roles: ["worker"], taskIds: ["t-2"] })).toEqual([]);
    }),
  );

const narrowsToWorkingDirectoriesThatStart = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seed(locations);
      expect(yield* entries(locations, { cwd: "/work/app-t" })).toEqual([
        "reviewer-user",
        "triage-user",
        "worker-result",
        "worker-user",
      ]);
      expect(yield* entries(locations, { cwd: "/work/other" })).toEqual([]);
    }),
  );

const takesDatesAsWholeLocalDays = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seed(locations);
      const until = yield* toolText(locations, { query: "release", until: "2026-10-01" });
      expect(until).toContain("plain-user");
      expect(until).not.toContain("worker-user");
      const since = yield* toolText(locations, { query: "release", since: "2026-10-02" });
      expect(since).toContain("worker-user");
      expect(since).not.toContain("plain-user");
      const newest = yield* toolText(locations, { order: "newest", query: "release" });
      expect(newest.indexOf("triage-user")).toBeLessThan(newest.indexOf("plain-user"));
      const oldest = yield* toolText(locations, { order: "oldest", query: "release" });
      expect(oldest.indexOf("plain-user")).toBeLessThan(oldest.indexOf("triage-user"));
    }),
  );

const namesTheSessionItsThreadTask = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const worker = yield* seed(locations);
      const text = yield* toolText(locations, { kinds: ["tool_result"], query: "passed" });
      for (const value of [worker, "worker-result", "worker", "t-1", "r-1", "th-w", "bash"])
        expect(text).toContain(value);
      expect(text).toContain("tool_result");
      expect(text).toContain("/work/app-t1");
    }),
  );

describe("search_sessions filters", () => {
  it(
    "tells orchestrator, worker, reviewer, triage, and ordinary sessions apart",
    tellsOrchestratorWorkerReviewerTriageAnd,
  );
  it(
    "narrows to tasks, threads, and rounds of orchestrator threads",
    narrowsToTasksThreadsAndRounds,
  );
  it(
    "narrows to working directories that start with the given text",
    narrowsToWorkingDirectoriesThatStart,
  );
  it("takes dates as whole local days and orders by time", takesDatesAsWholeLocalDays);
  it(
    "names the session, its thread, task, round, and role, and the kind and tool of each hit",
    namesTheSessionItsThreadTask,
  );
});
