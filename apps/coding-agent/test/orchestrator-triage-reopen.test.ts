import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { basenameOf, dirnameOf, joinPath, pathExists } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { escalateTriage, isTriage, runningTriage } = triageSupport;
const { sh, withRepository } = worktreeSupport;

const REQUEST = {
  options: [{ choice: "Keep the old API beside the new one", tradeoffs: "Two APIs to keep" }],
  unmet: "The goal asks to remove the old API and to keep every caller working; both cannot hold.",
};

const DECIDED = {
  conclusion: "decided",
  decision: "Route the old API's callers through an adapter, then remove the old API.",
  goalItems: [
    { how: "The old API is deleted once the adapter carries its callers.", item: 1 },
    { how: "Every caller goes through the adapter and keeps working.", item: 2 },
  ],
  grounds: "Both items hold with the adapter.",
};

type Ending = "closed" | "crashed";

const registered = (repository: string, checkout: string) =>
  Effect.map(sh("git worktree list --porcelain", repository), (listed) =>
    listed.includes(basenameOf(checkout)),
  );

const stoppedForADecision = (repository: string) =>
  Effect.gen(function* () {
    const databasePath = joinPath(dirnameOf(repository), "orchestrator.db");
    const first = setup({ cwd: repository, databasePath });
    const task = yield* create(first.orchestrator, {
      currentState: "the old API is used by every caller",
      goalState: ["- the old API is gone", "- every caller still works"].join("\n"),
      title: "remove the old API",
    });
    const dependent = yield* create(first.orchestrator, {
      currentState: "the docs describe the old API",
      dependsOn: [task.id],
      goalState: "the docs describe the new API",
      title: "update the docs",
    });
    const worker = first.workers[0]!;
    yield* Effect.promise(() => worker.requestDecision(REQUEST, "Stopping for a decision."));
    return { databasePath, dependent, first, task, worker };
  });

const end = (orchestrator: ReturnType<typeof setup>["orchestrator"], ending: Ending) =>
  ending === "closed"
    ? Effect.promise(() => orchestrator.dispose())
    : Effect.sync(() => orchestrator.database.close());

const triagesAgainAfterAReopen = (ending: Ending) =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { databasePath, dependent, first, task, worker } =
          yield* stoppedForADecision(repository);
        yield* waitFor(() => runningTriage(first.workers) !== undefined);
        const interrupted = runningTriage(first.workers)!;
        expect(yield* pathExists(interrupted.cwd)).toBe(true);
        yield* end(first.orchestrator, ending);
        expect(yield* pathExists(interrupted.cwd)).toBe(ending === "crashed");

        const second = setup({ cwd: repository, databasePath });
        yield* waitFor(() => runningTriage(second.workers) !== undefined);
        const triage = runningTriage(second.workers)!;
        expect(second.workers).toHaveLength(1);
        expect(triage.prompts[0]).toContain(REQUEST.unmet);
        expect(triage.cwd).not.toBe(interrupted.cwd);
        expect(yield* pathExists(interrupted.cwd)).toBe(false);
        expect(yield* registered(repository, interrupted.cwd)).toBe(false);
        expect(taskStatus(second.orchestrator, task.id)).toBe("running");
        expect(taskStatus(second.orchestrator, dependent.id)).toBe("waiting");

        yield* Effect.promise(() => triage.concludeTriage(DECIDED));
        yield* waitFor(() => second.workers.length === 2);
        const resumed = second.workers[1]!;
        expect(resumed.openedSessionFile).toBe(worker.sessionFile);
        expect(resumed.prompts[0]).toContain(DECIDED.decision);
        expect(resumed.prompts[0]).toContain(REQUEST.unmet);
        expect(taskStatus(second.orchestrator, task.id)).toBe("running");
        expect(second.reports.map((report) => report.details.status)).not.toContain(
          "needs-decision",
        );
        expect(yield* pathExists(triage.cwd)).toBe(false);
        expect(yield* registered(repository, triage.cwd)).toBe(false);
        yield* Effect.promise(() => second.orchestrator.dispose());
      }),
    ),
  );

it("keeps a decision request whose triage the session closed in the middle of, triages it again on reopen, and continues the stopped worker's session with the decision", () =>
  triagesAgainAfterAReopen("closed"));

it("keeps a decision request whose triage was cut off by a crash, triages it again on reopen, and removes the cut-off triage's checkout and its worktree entry", () =>
  triagesAgainAfterAReopen("crashed"));

const removesAnAdvisorCheckoutAfterAReopen = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { databasePath, first, task } = yield* stoppedForADecision(repository);
        yield* escalateTriage(first.workers);
        yield* waitFor(() => taskStatus(first.orchestrator, task.id) === "needs-decision");
        yield* Effect.promise(() => first.orchestrator.advise(task.id));
        yield* waitFor(() => first.workers.length === 3);
        const advisor = first.workers[2]!;
        expect(isTriage(advisor)).toBe(false);
        expect(yield* registered(repository, advisor.cwd)).toBe(true);
        yield* end(first.orchestrator, "crashed");

        const second = setup({ cwd: repository, databasePath });
        yield* Effect.promise(() => second.orchestrator.refresh());
        expect(yield* pathExists(advisor.cwd)).toBe(false);
        expect(yield* registered(repository, advisor.cwd)).toBe(false);
        expect(taskStatus(second.orchestrator, task.id)).toBe("needs-decision");
        expect(second.workers).toHaveLength(0);
        yield* Effect.promise(() => second.orchestrator.dispose());
      }),
    ),
  );

it(
  "removes the checkout and worktree entry of an advisor cut off by a crash when the session reopens, and leaves the task waiting for a decision",
  removesAnAdvisorCheckoutAfterAReopen,
);
