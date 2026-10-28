import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
import triageSupport from "./triage-support.ts";

const { runningTriage } = triageSupport;
const { taskStatus, waitFor } = orchestratorHarness.harness;
const { openedTask, withRemote } = pullRequestSupport;
const { classifierDecide } = reviewVerdictSupport;

type Remote = Parameters<Parameters<typeof withRemote>[0]>[0];

const RERUN_CI = {
  conclusion: "decided",
  decision: "Re-run the CI run that never finished with `gh run rerun`, then end the turn.",
  goalItems: [{ how: "The re-run CI lets the pull request merge to main.", item: 1 }],
  grounds: "Nothing in the work is wrong; a stalled run is fixed by running it again.",
};

const FINDING = "The pull request body does not name the re-run.";

const stalledCi = (remote: Remote, options: Parameters<typeof openedTask>[1] = {}) =>
  Effect.gen(function* () {
    const { github } = remote;
    const opened = yield* openedTask(remote, { ciWaitMs: 50, ...options });
    github.ci.set(yield* github.head(opened.branch), "pending");
    opened.workers[0]!.complete("waiting for CI");
    yield* waitFor(() => runningTriage(opened.workers) !== undefined);
    return { ...opened, triage: runningTriage(opened.workers)! };
  });

const triagesCiThatNeverFinishes = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { orchestrator, reports, taskId, triage, workers } = yield* stalledCi(remote);
        const worker = workers[0]!;
        expect(triage.prompts[0]).toContain("CI has not finished on the head");
        expect(taskStatus(orchestrator, taskId)).toBe("running");
        expect(reports.map((report) => report.details.status)).not.toContain("needs-decision");

        yield* Effect.promise(() => triage.concludeTriage(RERUN_CI));
        yield* waitFor(() => worker.prompts.length === 2);
        expect(worker.prompts[1]).toContain(RERUN_CI.decision);
        expect(taskStatus(orchestrator, taskId)).toBe("running");
        expect(reports.at(-1)?.details.status).toBe("sent-back");
        expect(reports.map((report) => report.details.status)).not.toContain("needs-decision");
      }),
    ),
  );

it(
  "hands CI that stays pending past the wait limit to a triage, which resumes the worker to re-run it instead of asking a human",
  triagesCiThatNeverFinishes,
);

const asksForADecisionWhenCiNeverFinishes = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { orchestrator, reports, number, taskId, triage, workers } = yield* stalledCi(remote);
        yield* Effect.promise(() => triage.escalate());
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "needs-decision");
        expect(workers[0]!.prompts).toHaveLength(1);
        expect(reports.at(-1)?.details.status).toBe("needs-decision");
        expect(reports.at(-1)?.text).toContain(`CI has not finished on the head`);
        expect(reports.at(-1)?.text).toContain(`#${number}`);
      }),
    ),
  );

it(
  "waits for a decision, instead of stopping or passing, when CI stays pending past the wait limit and the triage finds that only the user can decide",
  asksForADecisionWhenCiNeverFinishes,
);

const triagesADifferentRequestAfterADecisionThatChangedNoFile = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const unavailable = "the classifier backend cannot load";
        const { branch, orchestrator, reports, taskId, triage, workers } = yield* stalledCi(
          remote,
          { decide: classifierDecide({ unavailable }) },
        );
        const worker = workers[0]!;
        yield* Effect.promise(() => triage.concludeTriage(RERUN_CI));
        yield* waitFor(() => worker.prompts.length === 2);
        remote.github.ci.set(yield* remote.github.head(branch), "success");
        worker.complete("re-ran CI with gh run rerun; it passed");
        yield* waitFor(() => workers.length === 3);
        const reviewer = workers[2]!;
        const met = { evidence: "the diff", item: 1, status: "met" as const };
        yield* Effect.promise(() => reviewer.recordGoalItems([met], [FINDING]));
        reviewer.completeUnrecorded(`Acceptable.\n${FINDING}`);

        yield* waitFor(() => runningTriage(workers) !== undefined);
        const second = runningTriage(workers)!;
        expect(second).not.toBe(triage);
        expect(second.prompts[0]).toContain(unavailable);
        expect(second.prompts[0]).toContain("<earlier-triage-decisions>");
        expect(second.prompts[0]).toContain('files-changed-since="no"');
        expect(second.prompts[0]).toContain(RERUN_CI.decision);
        expect(taskStatus(orchestrator, taskId)).toBe("running");
        expect(reports.map((report) => report.details.status)).not.toContain("needs-decision");
      }),
    ),
  );

it(
  "triages an undecided review that follows a triage decision to re-run CI, though no file changed since that decision, and shows the triage the earlier decision",
  triagesADifferentRequestAfterADecisionThatChangedNoFile,
);
