import { Effect } from "effect";

import pullRequestFinish from "./pull-request-finish.ts";
import pullRequestOutside from "./pull-request-outside.ts";
import pullRequestProblems from "./pull-request-problems.ts";
import pullRequestRefresh from "./pull-request-refresh.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { finish, hasLiveRun } = pullRequestFinish;
const { judgeMerge, outsideMergeLine } = pullRequestOutside;
const { short } = pullRequestProblems;
const { nowMillis } = runtimeModule;
const { scheduling } = schedule;
const { store } = storeModule;

type TaskStatus = orchestratorTypesTypes.TaskStatus;

const SYNC_MS = 60_000;

const WATCHED: ReadonlySet<TaskStatus> = new Set(["needs-decision", "stopped", "failed"]);

const judgedOutside = new WeakMap<runtimeTypes.Runtime, Set<string>>();

type Judgement = NonNullable<Effect.Success<ReturnType<typeof judgeMerge>>>;

interface Read {
  before: orchestratorTypesTypes.PullRequest;
  judged: Judgement;
  line: string | undefined;
}

interface Settled {
  record: orchestratorTypesTypes.PullRequest;
  line: string | undefined;
  started: string[];
  status: "completed" | "stopped" | "failed";
  task: orchestratorTypesTypes.Task;
}

function outsideOf(runtime: runtimeTypes.Runtime): Set<string> {
  const seen = judgedOutside.get(runtime) ?? new Set<string>();
  judgedOutside.set(runtime, seen);
  return seen;
}

function keyOf(pull: orchestratorTypesTypes.PullRequest): string {
  return `${pull.taskId}#${pull.number}@${pull.mergeCommit ?? ""}`;
}

function watched(
  runtime: runtimeTypes.Runtime,
  taskId: string,
): orchestratorTypesTypes.Task | undefined {
  const task = store.getTask(runtime.database, taskId);
  if (task === undefined || !WATCHED.has(task.status) || hasLiveRun(runtime, taskId)) {
    return undefined;
  }
  return task;
}

function candidates(runtime: runtimeTypes.Runtime): orchestratorTypesTypes.Task[] {
  const outside = outsideOf(runtime);
  return store
    .listTasks(runtime.database, runtime.options.project)
    .filter((task) => WATCHED.has(task.status))
    .filter((task) => {
      const pull = store.pullRequestOf(runtime.database, task.id);
      if (pull?.state === "OPEN") return true;
      return pull?.state === "MERGED" && !outside.has(keyOf(pull));
    });
}

function lockedWrite(runtime: runtimeTypes.Runtime): runtimeTypes.Write {
  return (effect) => Effect.promise(() => runtime.exclusive(effect));
}

function readMerge(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<Read | undefined> {
  return Effect.gen(function* () {
    const before = store.pullRequestOf(runtime.database, task.id);
    if (before === undefined) return undefined;
    const record =
      before.state === "OPEN"
        ? yield* pullRequestRefresh.refresh(runtime, task.id, lockedWrite(runtime))
        : before;
    if (record?.state !== "MERGED") return undefined;
    const judged = yield* judgeMerge(runtime, task.cwd, record, () => undefined);
    if (judged === undefined) return undefined;
    const line =
      judged.by === "harness"
        ? undefined
        : yield* outsideMergeLine(runtime, task, task.cwd, judged);
    return { before, judged, line };
  });
}

function settle(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  read: Read,
): Effect.Effect<Omit<Settled, "started"> | undefined> {
  return Effect.gen(function* () {
    const task = watched(runtime, taskId);
    const { before, judged, line } = read;
    const { record } = judged;
    const current = store.pullRequestOf(runtime.database, taskId);
    if (task === undefined || current?.number !== record.number || current.state !== "MERGED") {
      return undefined;
    }
    const now = yield* nowMillis;
    if (judged.by === "harness") {
      if (current.harnessCommit === null && record.harnessCommit !== null) {
        store.markHarnessCommit(runtime.database, taskId, record.harnessCommit);
      }
      store.setTaskStatus(runtime.database, taskId, "completed", now);
      return { line, record, status: "completed", task };
    }
    if (judged.by === "outside") outsideOf(runtime).add(keyOf(record));
    if (task.status === "needs-decision") {
      store.setTaskStatus(runtime.database, taskId, "stopped", now);
      return { line, record, status: "stopped", task };
    }
    if (before.state !== "OPEN") return undefined;
    return { line, record, status: task.status === "failed" ? "failed" : "stopped", task };
  });
}

function syncTask(
  runtime: runtimeTypes.Runtime,
  taskId: string,
): Effect.Effect<Settled | undefined> {
  return Effect.gen(function* () {
    const task = watched(runtime, taskId);
    if (task === undefined) return undefined;
    const read = yield* readMerge(runtime, task);
    if (read === undefined) return undefined;
    return yield* Effect.promise(() =>
      runtime.exclusive(
        Effect.gen(function* () {
          const settled = yield* settle(runtime, taskId, read);
          if (settled === undefined) return undefined;
          const started = yield* scheduling.scheduleEffect(runtime);
          runtime.publish();
          return { ...settled, started };
        }),
      ),
    );
  });
}

function lineOf(runtime: runtimeTypes.Runtime, settled: Settled): Effect.Effect<string> {
  const { line, record, task } = settled;
  if (line !== undefined) return Effect.succeed(line);
  return Effect.map(
    finish(
      runtime,
      task,
      record.branch,
      `PR #${record.number} was merged at head ${short(record.headSha)} as merge commit ${short(record.mergeCommit ?? "")}, so ${task.id} is completed, not ${task.status}.`,
    ),
    (finished) => finished.line,
  );
}

function syncOne(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const settled = yield* syncTask(runtime, task.id);
    if (settled === undefined) return;
    const line = yield* lineOf(runtime, settled);
    runtime.options.report(`${task.title} (${task.id}) ${settled.status}.\n\n${line}`, {
      role: "reviewer",
      started: settled.started,
      status: settled.status,
      taskId: task.id,
    });
  }).pipe(Effect.ignoreCause);
}

function sweep(runtime: runtimeTypes.Runtime): Effect.Effect<void> {
  return Effect.forEach(candidates(runtime), (task) => syncOne(runtime, task), { discard: true });
}

function loop(runtime: runtimeTypes.Runtime, intervalMs: number = SYNC_MS): Effect.Effect<never> {
  return Effect.forever(
    Effect.sleep(intervalMs).pipe(
      Effect.andThen(
        Effect.suspend(() => (runtime.database.isOpen ? sweep(runtime) : Effect.void)),
      ),
    ),
  );
}

const pullRequestSync = { loop, sweep };

export default pullRequestSync;
