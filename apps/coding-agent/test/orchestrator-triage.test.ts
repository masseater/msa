import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, writeTextFile } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { runningTriage } = triageSupport;
const { withRepository } = worktreeSupport;

const REQUEST = {
  options: [
    { choice: "Keep the old API beside the new one", tradeoffs: "Two APIs to keep" },
    { choice: "Drop the old API", tradeoffs: "Breaks callers outside the goal" },
  ],
  unmet: "The goal asks to remove the old API and to keep every caller working; both cannot hold.",
};

const DECIDED = {
  conclusion: "decided",
  decision:
    "Route the old API's callers through an adapter over the new API, then remove the old API.",
  goalItems: [
    { how: "The old API is deleted once the adapter carries its callers.", item: 1 },
    { how: "Every caller goes through the adapter and keeps working.", item: 2 },
  ],
  grounds: "Both items hold with the adapter; the commit log already moved two APIs this way.",
};

const GOAL = ["- the old API is gone", "- every caller still works"].join("\n");

const stoppedTask = (repository: string) =>
  Effect.gen(function* () {
    const setUp = setup({ cwd: repository });
    const statuses: (string | undefined)[] = [];
    const task = yield* create(setUp.orchestrator, {
      currentState: "the old API is used by every caller",
      goalState: GOAL,
      title: "remove the old API",
    });
    const dependent = yield* create(setUp.orchestrator, {
      currentState: "the docs describe the old API",
      dependsOn: [task.id],
      goalState: "the docs describe the new API",
      title: "update the docs",
    });
    setUp.orchestrator.onChange(() => statuses.push(taskStatus(setUp.orchestrator, task.id)));
    const worker = setUp.workers[0]!;
    yield* Effect.promise(() => worker.requestDecision(REQUEST, "Stopping for a decision."));
    yield* waitFor(() => runningTriage(setUp.workers) !== undefined);
    return { ...setUp, dependent, statuses, task, triage: runningTriage(setUp.workers)!, worker };
  });

const resumesTheWorkerWithTheTriageDecision = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { dependent, orchestrator, reports, statuses, task, triage, worker, workers } =
          yield* stoppedTask(repository);
        expect(triage.readOnly).toBe(true);
        expect(triage.tools.map((tool) => tool.name)).toEqual(["conclude_triage"]);
        expect(triage.cwd).not.toBe(worker.cwd);
        expect(triage.prompts[0]).toContain(REQUEST.unmet);
        expect(triage.prompts[0]).toContain("2. every caller still works");
        expect(triage.prompts[0]).toContain("<commit-log>");
        expect(triage.prompts[0]).toContain("<agents-md>");
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        expect(taskStatus(orchestrator, dependent.id)).toBe("waiting");

        yield* Effect.promise(() => triage.concludeTriage(DECIDED));
        yield* waitFor(() => worker.prompts.length === 2);
        expect(worker.prompts[1]).toContain(DECIDED.decision);
        expect(worker.prompts[1]).toContain("A triage thread found that no human needs to decide");
        expect(worker.prompts[1]).toContain(REQUEST.unmet);
        expect(workers).toHaveLength(2);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        expect(statuses).not.toContain("needs-decision");
        expect(reports.map((report) => report.details.status)).not.toContain("needs-decision");
        expect(reports.at(-1)?.details).toMatchObject({ role: "triage", status: "sent-back" });
        expect(reports.at(-1)?.text).toContain("Triage decided without a human");
        const view = yield* Effect.promise(() => orchestrator.read(task.id));
        expect(view.reports.at(-1)?.content).toContain(DECIDED.grounds);

        worker.complete("added the adapter and removed the old API");
        yield* waitFor(() => workers.length === 3);
        workers[2]!.complete("Acceptable.");
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
        yield* waitFor(() => taskStatus(orchestrator, dependent.id) === "running");
        expect(statuses).not.toContain("needs-decision");
      }),
    ),
  );

it(
  "runs a read-only triage before a decision request reaches anyone, and when it decides, continues the worker's own session with the decision without the task ever waiting for a decision",
  resumesTheWorkerWithTheTriageDecision,
);

const escalates = (
  conclude: (triage: ReturnType<typeof runningTriage> & object) => Promise<void>,
  says: string,
) =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { dependent, orchestrator, reports, task, triage } = yield* stoppedTask(repository);
        yield* Effect.promise(() => conclude(triage));
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
        expect(taskStatus(orchestrator, dependent.id)).toBe("waiting");
        expect(reports.at(-1)?.details).toMatchObject({ role: "triage", status: "needs-decision" });
        expect(reports.at(-1)?.text).toContain(says);
        expect(reports.at(-1)?.text).toContain(REQUEST.unmet);
        expect(reports.at(-1)?.text).toContain("Drop the old API");
      }),
    ),
  );

it("hands the request to the orchestrator when the triage finds only the user can decide", () =>
  escalates(
    (triage) => triage.escalate(),
    "only the user can decide this (a choice of specification nobody has made yet)",
  ));

it("hands the request to the orchestrator when the only way the triage finds is a compromise", () =>
  escalates(
    (triage) => triage.concludeTriage({ ...DECIDED, narrowsGoal: true }),
    "narrows the goal, which is a compromise",
  ));

it("hands the request to the orchestrator when the triage ends without a conclusion", () =>
  escalates((triage) => {
    triage.completeUnrecorded("I cannot tell.");
    return Promise.resolve();
  }, "without a conclusion"));

const refusesAnIncompleteConclusion = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { triage } = yield* stoppedTask(repository);
        yield* Effect.promise(() =>
          expect(
            triage.concludeTriage({ ...DECIDED, goalItems: [DECIDED.goalItems[0]] }),
          ).rejects.toThrow("none says how it meets item 2"),
        );
        yield* Effect.promise(() =>
          expect(
            triage.concludeTriage({ conclusion: "needs-human", decision: "?", grounds: "?" }),
          ).rejects.toThrow("needs-human needs humanReason"),
        );
      }),
    ),
  );

it(
  "refuses a decided conclusion that skips a goal item and a needs-human one without the reason only the user can decide",
  refusesAnIncompleteConclusion,
);

const decideOnce = (repository: string) =>
  Effect.gen(function* () {
    const stopped = yield* stoppedTask(repository);
    yield* Effect.promise(() => stopped.triage.concludeTriage(DECIDED));
    yield* waitFor(() => stopped.worker.prompts.length === 2);
    return stopped;
  });

const sendsTheSameRequestToTheOrchestrator = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, reports, task, worker, workers } = yield* decideOnce(repository);
        yield* Effect.promise(() => worker.requestDecision(REQUEST));
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
        expect(workers).toHaveLength(2);
        expect(reports.at(-1)?.details).toMatchObject({ role: "worker", status: "needs-decision" });
        expect(reports.at(-1)?.text).toContain(
          "The same request came back word for word after a triage decided it",
        );
      }),
    ),
  );

it(
  "sends the same request to the orchestrator instead of another triage when the worker stops with it again after a triage decided it",
  sendsTheSameRequestToTheOrchestrator,
);

const REWORDED = { ...REQUEST, unmet: "Removing the old API still breaks a caller." };

const rewordedTriage = (repository: string) =>
  Effect.gen(function* () {
    const decided = yield* decideOnce(repository);
    yield* Effect.promise(() => decided.worker.requestDecision(REWORDED));
    yield* waitFor(() => decided.workers.length === 3);
    return { ...decided, second: decided.workers[2]! };
  });

const letsTheTriageJudgeARewordedRequest = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, reports, second, task } = yield* rewordedTriage(repository);
        expect(second.tools.map((tool) => tool.name)).toEqual(["conclude_triage"]);
        expect(second.prompts[0]).toContain(REWORDED.unmet);
        expect(second.prompts[0]).toContain('<decision number="1" files-changed-since="no">');
        expect(second.prompts[0]).toContain(DECIDED.decision);
        expect(taskStatus(orchestrator, task.id)).toBe("running");

        yield* Effect.promise(() =>
          second.concludeTriage({
            conclusion: "repeat",
            decision: "The adapter way again.",
            grounds: "It asks what decision 1 answered.",
            repeats: 1,
          }),
        );
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
        expect(reports.at(-1)?.details).toMatchObject({ role: "triage", status: "needs-decision" });
        expect(reports.at(-1)?.text).toContain("asks the same thing as earlier triage decision 1");
      }),
    ),
  );

it(
  "triages a reworded request even when no file changed since the last decision, shows the triage the earlier decisions, and hands it to the orchestrator when the triage finds it repeats one",
  letsTheTriageJudgeARewordedRequest,
);

const refusesARepeatOfNothing = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { triage } = yield* stoppedTask(repository);
        yield* Effect.promise(() =>
          expect(
            triage.concludeTriage({
              conclusion: "repeat",
              decision: "?",
              grounds: "?",
              repeats: 1,
            }),
          ).rejects.toThrow("No earlier triage of this task decided anything"),
        );
      }),
    ),
  );

it(
  "refuses a repeat conclusion when no earlier triage of the task decided anything",
  refusesARepeatOfNothing,
);

const triagesANewRequestAfterWork = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, task, worker, workers } = yield* decideOnce(repository);
        yield* writeTextFile(joinPath(worker.cwd, "adapter.txt"), "adapter\n");
        yield* Effect.promise(() =>
          worker.requestDecision({
            ...REQUEST,
            unmet: "The adapter needs a name the goal does not give.",
          }),
        );
        yield* waitFor(() => workers.length === 3);
        expect(workers[2]!.tools.map((tool) => tool.name)).toEqual(["conclude_triage"]);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
      }),
    ),
  );

it(
  "triages a new request again once the worker has changed files since the last triage decision",
  triagesANewRequestAfterWork,
);
