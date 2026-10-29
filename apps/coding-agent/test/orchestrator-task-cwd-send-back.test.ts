import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
import taskCwdFollowUpSupport from "./task-cwd-follow-up-support.ts";

const { setup, taskStatus, waitFor } = orchestratorHarness.harness;
const { classifierDecide } = reviewVerdictSupport;
const { lintTask, refusalsOf, removeTaskCwd, reportedStarted, threadsOf, withLintRepository } =
  taskCwdFollowUpSupport;
const { runCommand } = orchestratorCallbacks;

const doesNotReportARefusedSendBackAsStarted = () =>
  Effect.runPromise(
    withLintRepository((repository) =>
      Effect.gen(function* () {
        const decide = classifierDecide(() => ({ fail: 0.9, pass: 0.1 }));
        const session = setup({ cwd: repository, decide, runCommand });
        const { orchestrator } = session;
        const lint = yield* lintTask(session, repository, false);
        session.workers[0]!.complete("lint is clean");
        yield* waitFor(() => session.workers.length === 2);
        yield* removeTaskCwd(repository);

        session.workers[1]!.complete("Not acceptable.\nlint.txt still lists errors");
        yield* waitFor(() => refusalsOf(session, lint.id).length === 1);
        yield* waitFor(() =>
          session.reports.some(
            (report) => report.details.taskId === lint.id && report.details.role === "reviewer",
          ),
        );
        expect(taskStatus(orchestrator, lint.id)).toBe("stopped");
        expect(threadsOf(orchestrator, lint.id)).toBe(2);
        expect(session.workers).toHaveLength(2);
        expect(reportedStarted(session)).not.toContain(lint.id);
      }),
    ),
  );

it(
  "does not report a send-back the cwd check refused as started",
  doesNotReportARefusedSendBackAsStarted,
);
