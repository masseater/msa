import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import tools from "../src/core/orchestrator/tools.ts";
import goalChecksSupport from "./orchestrator-goal-checks-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, makeTempDir, removePath } = testing;
const { LINT_CHECK } = goalChecksSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { escalateTriage } = triageSupport;
const { sh, withRepository } = worktreeSupport;
const { createOrchestratorToolDefinitions } = tools;

type Session = ReturnType<typeof setup>;
type ToolName = "consult_advisor" | "rerun_task" | "send_message";

function withOutside<A, E>(body: (outside: string) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(makeTempDir("msa-task-cwd-tools-"), body, (outside) =>
    removePath(outside),
  );
}

const threadsOf = (orchestrator: orchestratorTypes.Orchestrator, taskId: string) =>
  orchestrator.snapshot.threads.filter((thread) =>
    thread.tasks.some((assignment) => assignment.taskId === taskId),
  ).length;

function call(session: Session, name: ToolName, params: Record<string, string>) {
  const definition = createOrchestratorToolDefinitions(session.orchestrator)[name];
  return Effect.promise(() =>
    definition.execute("call", params as never, undefined, undefined, undefined as never).then(
      () => ({ failed: false, message: "" }),
      (error: unknown) => ({ failed: true, message: String(error) }),
    ),
  );
}

function expectRefused(
  result: { failed: boolean; message: string },
  taskId: string,
  cwd: string,
): void {
  expect(result.failed).toBe(true);
  expect(result.message).toContain(` ${cwd} `);
  expect(result.message).toContain(
    `Replan with ${taskId} in from and cwd as the path of a checkout`,
  );
}

const rerunAndSendMessageFailWithTheRemedy = () =>
  Effect.runPromise(
    withOutside((outside) =>
      withRepository((repository) =>
        Effect.gen(function* () {
          const session = setup({ cwd: outside });
          const { orchestrator } = session;
          const cwd = joinPath(repository, "app");
          const lint = yield* create(orchestrator, {
            checks: [LINT_CHECK],
            currentState: "lint reports 3 errors",
            cwd,
            goalState: "lint reports 0 errors",
            title: "lint",
          });
          yield* waitFor(() => session.workers.length === 1);
          yield* Effect.promise(() => orchestrator.stop(lint.id));
          yield* sh("rm -rf .git", repository);

          expectRefused(yield* call(session, "rerun_task", { taskId: lint.id }), lint.id, cwd);
          expectRefused(
            yield* call(session, "send_message", { message: "try again", taskId: lint.id }),
            lint.id,
            cwd,
          );
          expect(taskStatus(orchestrator, lint.id)).toBe("stopped");
          expect(threadsOf(orchestrator, lint.id)).toBe(1);
          expect(session.workers).toHaveLength(1);
        }),
      ),
    ),
  );

it(
  "fails rerun_task and send_message with the refusal and its replan remedy when the task's cwd is no longer a git working tree",
  rerunAndSendMessageFailWithTheRemedy,
);

const consultAdvisorFailsWithTheRemedy = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const session = setup({
          cwd: repository,
          runCommand: () => Promise.resolve({ exitCode: 0, output: "0 errors\n" }),
        });
        const { orchestrator } = session;
        const lint = yield* create(orchestrator, {
          checks: [LINT_CHECK],
          currentState: "lint reports 3 errors",
          goalState: "lint reports 0 errors and no rule is disabled",
          title: "lint",
        });
        const worker = session.workers[0]!;
        yield* Effect.promise(() =>
          worker.requestDecision({
            options: [{ choice: "Disable the rule", tradeoffs: "Breaks the goal" }],
            unmet: "The last error comes from a rule the goal forbids disabling.",
          }),
        );
        yield* escalateTriage(session.workers);
        yield* waitFor(() => taskStatus(orchestrator, lint.id) === "needs-decision");
        const threads = threadsOf(orchestrator, lint.id);
        yield* sh("rm -rf .git", repository);

        expectRefused(
          yield* call(session, "consult_advisor", { taskId: lint.id }),
          lint.id,
          repository,
        );
        expect(taskStatus(orchestrator, lint.id)).toBe("stopped");
        expect(threadsOf(orchestrator, lint.id)).toBe(threads);
      }),
    ),
  );

it(
  "fails consult_advisor with the refusal and its replan remedy when the task's cwd is no longer a git working tree",
  consultAdvisorFailsWithTheRemedy,
);
