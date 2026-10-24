import testing from "@msa/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { afterEach, expect, it, vi } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";

const { makeTempDir, provideNode, removePath } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus } = harness;
const { TASK, advance, fakeClock, storedStatus } = watchdogSupport;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Setup = ReturnType<typeof setup>;

afterEach(() => {
  vi.useRealTimers();
});

const deadPid = provideNode(
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make("node", ["-e", ""], {
        stderr: "ignore",
        stdin: "ignore",
        stdout: "ignore",
      });
      yield* child.exitCode;
      return Number(child.pid);
    }),
  ),
).pipe(Effect.orDie);

const sharedDatabase = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-orchestrator-watchdog-");
  return { databasePath: `${directory}/orchestrator.db`, directory };
});

const ownerPid = (orchestrator: Setup["orchestrator"], project: string) =>
  (
    orchestrator.database
      .prepare("SELECT owner_pid FROM orchestrator_state WHERE project = ?")
      .get(project) as { owner_pid: number | null }
  ).owner_pid;

const putsTasksOfAGoneProcessBackToWaiting = () =>
  Effect.gen(function* () {
    const pid = yield* deadPid;
    const { databasePath, directory } = yield* sharedDatabase;
    yield* fakeClock();
    const previous = setup({ databasePath, project: "previous" });
    const task = yield* create(previous.orchestrator, TASK);
    const current = setup({ databasePath, project: "current" });
    current.orchestrator.database
      .prepare("UPDATE orchestrator_state SET owner_pid = ? WHERE project = 'previous'")
      .run(pid);

    yield* advance(10 * MINUTE);

    expect(storedStatus(current.orchestrator, task.id)).toBe("waiting");
    expect(current.reports).toEqual([]);
    previous.orchestrator.database.close();

    const reopened = setup({ databasePath, pollIntervalMs: 1000, project: "previous" });
    yield* advance(1000);
    expect(reopened.reports.at(-1)?.text).toMatch(
      new RegExp(
        `cache reads \\(${task.id}\\): running when its orchestrator process ${pid} was gone, 1m after its last update`,
        "u",
      ),
    );
    expect(taskStatus(reopened.orchestrator, task.id)).toBe("running");
    yield* Effect.promise(() => reopened.orchestrator.dispose());
    yield* Effect.promise(() => current.orchestrator.dispose());
    yield* removePath(directory);
  });

it("puts the tasks of a gone orchestrator process back to waiting", () =>
  Effect.runPromise(Effect.scoped(putsTasksOfAGoneProcessBackToWaiting())));

const leavesALiveOrchestratorsThreadsAlone = () =>
  Effect.gen(function* () {
    const { databasePath, directory } = yield* sharedDatabase;
    yield* fakeClock();
    const other = setup({ databasePath, project: "other" });
    const task = yield* create(other.orchestrator, TASK);
    const current = setup({ databasePath, project: "current" });

    yield* advance(10 * MINUTE);

    expect(storedStatus(current.orchestrator, task.id)).toBe("running");
    expect(current.reports).toEqual([]);
    yield* Effect.promise(() => current.orchestrator.dispose());
    yield* Effect.promise(() => other.orchestrator.dispose());
    yield* removePath(directory);
  });

it("leaves the threads of a live orchestrator alone", () =>
  Effect.runPromise(Effect.scoped(leavesALiveOrchestratorsThreadsAlone())));

const closingASessionPutsItsTasksBackToWaiting = () =>
  Effect.gen(function* () {
    const { databasePath, directory } = yield* sharedDatabase;
    yield* fakeClock();
    const previous = setup({ databasePath, project: "previous" });
    const task = yield* create(previous.orchestrator, TASK);
    const current = setup({ databasePath, project: "current" });
    yield* advance(5 * MINUTE);
    yield* Effect.promise(() => previous.orchestrator.dispose());

    expect(storedStatus(current.orchestrator, task.id)).toBe("waiting");
    expect(ownerPid(current.orchestrator, "previous")).toBeNull();
    yield* advance(10 * MINUTE);
    expect(current.reports).toEqual([]);

    const reopened = setup({ databasePath, pollIntervalMs: 1000, project: "previous" });
    yield* advance(1000);
    expect(reopened.reports.at(-1)?.text).toMatch(
      /cache reads \(.+\): running when the session closed, 5m after its last update/u,
    );
    expect(reopened.reports.at(-1)?.text).toMatch(/^A task was left running .+ waiting again/u);
    expect(reopened.reports.at(-1)?.details.status).toBe("waiting");
    expect(taskStatus(reopened.orchestrator, task.id)).toBe("running");
    yield* Effect.promise(() => reopened.orchestrator.dispose());
    yield* Effect.promise(() => current.orchestrator.dispose());
    yield* removePath(directory);
  });

it("puts the tasks of a closed session back to waiting and reports them on reopen", () =>
  Effect.runPromise(Effect.scoped(closingASessionPutsItsTasksBackToWaiting())));

const leavesAProjectWithoutAnOwnerUntilItReopens = () =>
  Effect.gen(function* () {
    const { databasePath, directory } = yield* sharedDatabase;
    yield* fakeClock();
    const previous = setup({ databasePath, project: "previous" });
    const task = yield* create(previous.orchestrator, TASK);
    previous.orchestrator.database
      .prepare("UPDATE orchestrator_state SET owner_pid = NULL WHERE project = 'previous'")
      .run();
    previous.orchestrator.database.close();
    const current = setup({ databasePath, project: "current" });

    yield* advance(HOUR);

    expect(storedStatus(current.orchestrator, task.id)).toBe("running");
    expect(current.reports).toEqual([]);

    const reopened = setup({ databasePath, pollIntervalMs: 1000, project: "previous" });
    yield* advance(1000);
    expect(reopened.reports.at(-1)?.text).toMatch(
      /cache reads \(.+\): running when the session reopened, 1h 0m after its last update/u,
    );
    expect(taskStatus(reopened.orchestrator, task.id)).toBe("running");
    yield* Effect.promise(() => reopened.orchestrator.dispose());
    yield* Effect.promise(() => current.orchestrator.dispose());
    yield* removePath(directory);
  });

it("leaves a project with no recorded owner until its session reopens", () =>
  Effect.runPromise(Effect.scoped(leavesAProjectWithoutAnOwnerUntilItReopens())));
