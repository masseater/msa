import { Clock, Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import providerWaitSupport from "./provider-wait-support.ts";
import taskCwdFollowUpSupport from "./task-cwd-follow-up-support.ts";
import triageRequestSupport from "./triage-request-support.ts";
import triageSupport from "./triage-support.ts";

const { setup, taskStatus, waitFor } = orchestratorHarness.harness;
const { create } = orchestratorSupport;
const { HOUR, sessionLimit } = providerWaitSupport;
const { REQUEST } = triageRequestSupport;
const { runningTriage } = triageSupport;
const { lintTask, refusalsOf, removeTaskCwd, reportedStarted, threadsOf, withLintRepository } =
  taskCwdFollowUpSupport;
const { runCommand } = orchestratorCallbacks;

afterEach(() => {
  vi.useRealTimers();
});

const doesNotCountARefusedTriageResumeAsStarted = () =>
  Effect.runPromise(
    withLintRepository((repository) =>
      Effect.gen(function* () {
        vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
        const session = setup({ cwd: repository, maxConcurrent: 2, runCommand });
        const { orchestrator } = session;
        const lint = yield* lintTask(session, repository);
        const other = yield* create(orchestrator, {
          currentState: "the notes are scattered",
          goalState: "the notes are in one file",
          opensPullRequest: false,
          title: "gather notes",
        });
        yield* Effect.promise(() =>
          session.workers[0]!.requestDecision(REQUEST, "Stopping for a decision."),
        );
        yield* waitFor(() => runningTriage(session.workers) !== undefined);
        const triage = runningTriage(session.workers)!;
        Reflect.set(triage, "sessionFile", undefined);
        triage.endTurnWithError(sessionLimit((yield* Clock.currentTimeMillis) + HOUR));
        yield* waitFor(() =>
          session.reports.some(
            (report) => report.details.role === "triage" && report.details.status === "waiting",
          ),
        );
        const started = session.workers.length;

        yield* removeTaskCwd(repository);
        vi.setSystemTime((yield* Clock.currentTimeMillis) + 2 * HOUR);
        session.workers[1]!.complete("the notes are in notes.md");
        yield* waitFor(() => session.reports.some((report) => report.details.taskId === other.id));

        expect(refusalsOf(session, lint.id)).toHaveLength(1);
        expect(taskStatus(orchestrator, lint.id)).toBe("stopped");
        expect(threadsOf(orchestrator, lint.id)).toBe(2);
        expect(session.workers).toHaveLength(started + 1);
        expect(session.workers.at(-1)!.tools.map((tool) => tool.name)).toContain(
          "record_goal_items",
        );
        expect(reportedStarted(session)).not.toContain(lint.id);
      }),
    ),
  );

it(
  "does not count a triage the cwd check refused on the provider resume as started",
  doesNotCountARefusedTriageResumeAsStarted,
);
