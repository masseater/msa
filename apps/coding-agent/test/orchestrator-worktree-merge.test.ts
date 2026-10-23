import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create, replan, stopAndWrapUp } = orchestratorReplanSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { GIT, gatedTarget, read, runCommand, sh, shortId, withRepository } = worktreeSupport;

function failChecks(worker: { prompts: string[]; complete: (reply: string) => void }) {
  return Effect.gen(function* () {
    for (let attempt = 1; attempt <= 3; attempt++) {
      worker.complete(`done, try ${attempt}`);
      yield* waitFor(() => worker.prompts.length === attempt + 1);
    }
    worker.complete("done, try 4");
  });
}

function rejection(attempt: () => Promise<unknown>) {
  return Effect.promise(() =>
    attempt().then(
      () => "",
      (error: unknown) => String(error),
    ),
  );
}

const readsTheWorktreeForTheReplanMemo = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({ cwd: repository, runCommand });
        const task = yield* create(orchestrator, {
          currentState: "the client speaks v2",
          goalState: "the client speaks v3",
          title: "port",
        });
        const worker = workers[0]!;
        yield* sh(
          `echo v3 > client.txt && git add client.txt && ${GIT} commit -q -m port-the-client`,
          worker.cwd,
        );

        const pending = replan(orchestrator, {
          reason: "the api moved again",
          tasks: [{ from: [task.id], title: "port again" }],
        });
        yield* stopAndWrapUp(orchestrator, [worker], "ported the client");
        yield* Effect.promise(() => pending);

        const memo =
          (yield* read(orchestrator, task.id)).reports.find((report) =>
            report.content.startsWith("replan "),
          )?.content ?? "";
        expect(memo).toContain(`branch task/${shortId(task.id)} · commit`);
        expect(memo).toContain("port-the-client");
      }),
    ),
  );

it(
  "describes the task's worktree, not the main checkout, in the memo a replan hands on",
  readsTheWorktreeForTheReplanMemo,
);

const keepsTheMergeLinkThroughReplans = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const { gate, target } = yield* gatedTarget(orchestrator);
      const part = yield* create(orchestrator, {
        currentState: "c",
        goalState: "d",
        mergeInto: target.id,
        title: "part",
      });

      const result = yield* Effect.promise(() =>
        orchestrator.replan({
          reason: "the integration needs another plan",
          stop: false,
          tasks: [{ from: [target.id], title: "integrate again" }],
        }),
      );
      const next = result.created[0]!.taskId;
      expect((yield* read(orchestrator, part.id)).mergeInto).toBe(next);

      yield* Effect.promise(() =>
        orchestrator.replan({
          keep: [next],
          reason: "the integration only needs the gate",
          rewire: [{ dependsOn: [gate.id], taskId: next }],
          stop: false,
        }),
      );
      expect((yield* read(orchestrator, next)).dependsOn).toEqual([gate.id, part.id].toSorted());

      const removal = yield* rejection(() =>
        orchestrator.setDepends({ remove: [part.id], taskIds: [next] }),
      );
      expect(removal).toContain(`${part.id} merges into ${next}`);
      expect(taskStatus(orchestrator, next)).toBe("waiting");
    }),
  );

it(
  "moves the tasks that merge into a replaced task to its replacement, and keeps the target waiting for them",
  keepsTheMergeLinkThroughReplans,
);

const listsOnlyTheSourcesStillWorking = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({ cwd: repository, runCommand });
        const { target } = yield* gatedTarget(orchestrator);
        const part = (title: string, checks: { command: string }[] = []) =>
          create(orchestrator, {
            checks,
            currentState: "c",
            goalState: "d",
            mergeInto: target.id,
            title,
          });
        const dropped = yield* part("dropped part");
        const failed = yield* part("failed part", [{ command: "false" }]);
        const kept = yield* part("kept part");
        yield* failChecks(workers[2]!);
        yield* waitFor(() => taskStatus(orchestrator, failed.id) === "failed");
        yield* Effect.promise(() =>
          orchestrator.setDepends({ remove: [failed.id], taskIds: [target.id] }),
        );
        yield* Effect.promise(() => orchestrator.stop(dropped.id));
        yield* Effect.promise(() =>
          orchestrator.replan({
            drop: [{ reason: "the kept part covers it", taskId: dropped.id }],
            reason: "one part is enough",
            stop: false,
          }),
        );

        workers[0]!.complete("gate done");
        yield* waitFor(() => workers.length === 5);
        workers[4]!.complete("acceptable");
        workers[3]!.complete("kept part pushed");
        yield* waitFor(() => workers.length === 6);
        workers[5]!.complete("acceptable");
        yield* waitFor(() => workers.length === 7);

        const prompt = workers[6]!.prompts[0] ?? "";
        expect(prompt).toContain(`- task/${shortId(kept.id)} (task ${kept.id} "kept part")`);
        expect(prompt).not.toContain(`task/${shortId(dropped.id)}`);
        expect(prompt).not.toContain(`task/${shortId(failed.id)}`);
      }),
    ),
  );

it(
  "lists to the merge target only the tasks that still merge into it, not dropped, stopped, or failed ones",
  listsOnlyTheSourcesStillWorking,
);

const rerunsInTheSameWorktree = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({ cwd: repository, runCommand });
        const task = yield* create(orchestrator, {
          currentState: "draft.txt is missing",
          goalState: "draft.txt is final",
          title: "draft",
        });
        const first = workers[0]!;
        yield* sh("echo draft > draft.txt", first.cwd);
        yield* Effect.promise(() => orchestrator.stop(task.id));

        const before = workers.length;
        yield* Effect.promise(() => orchestrator.rerun(task.id));
        yield* waitFor(() => workers.length === before + 1);
        const second = workers.at(-1)!;

        expect(second.cwd).toBe(first.cwd);
        expect(yield* sh("git rev-parse --abbrev-ref HEAD", second.cwd)).toBe(
          `task/${shortId(task.id)}`,
        );
        expect(yield* sh("cat draft.txt", second.cwd)).toBe("draft");
        expect(yield* sh("git worktree list --porcelain | grep -c '^worktree '", repository)).toBe(
          "2",
        );
      }),
    ),
  );

it(
  "reruns a stopped task in the worktree it already has, with its uncommitted work",
  rerunsInTheSameWorktree,
);

const refusesToInheritAStartedTarget = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const { target } = yield* gatedTarget(orchestrator);
      const part = yield* create(orchestrator, {
        currentState: "c",
        goalState: "d",
        mergeInto: target.id,
        title: "part",
      });
      yield* Effect.promise(() => orchestrator.stop(part.id));
      yield* Effect.promise(() =>
        orchestrator.setDepends({ remove: [part.id], taskIds: [target.id] }),
      );
      workers[0]!.complete("gate done");
      yield* waitFor(() => workers.length === 3);
      workers[2]!.complete("acceptable");
      yield* waitFor(() => taskStatus(orchestrator, target.id) === "running");
      const before = orchestrator.snapshot.tasks.length;

      const refused = yield* rejection(() =>
        orchestrator.replan({
          reason: "the part needs another try",
          stop: false,
          tasks: [{ from: [part.id], title: "part again" }],
        }),
      );

      expect(refused).toContain(`would inherit mergeInto ${target.id} from ${part.id}`);
      expect(refused).toContain(`${target.id} is running`);
      expect(orchestrator.snapshot.tasks).toHaveLength(before);
      expect(taskStatus(orchestrator, part.id)).toBe("stopped");
    }),
  );

it(
  "refuses a replan whose new task would inherit a merge target that has already started",
  refusesToInheritAStartedTarget,
);
