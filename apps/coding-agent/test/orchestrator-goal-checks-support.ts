import { Effect } from "effect";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";
import worktreeSupport from "./worktree-support.ts";

const { setup, withTempDir } = orchestratorHarness.harness;
const { withRepository } = worktreeSupport;

const LINT_CHECK = { command: "cat lint.txt", output: "^0 errors$" };
const SHORTCUT_CHECK = { command: "grep -c 'layer-[0-9]' src.txt", exitCode: 1 };

function withRepo<A, E>(body: (directory: string) => Effect.Effect<A, E>): Effect.Effect<A, E> {
  return withTempDir("msa-goal-checks-", body);
}

function heldCommand() {
  const calls: { command: string; signal: AbortSignal; release: (output?: string) => void }[] = [];
  const runCommand = (command: string, _cwd: string, _timeoutMs: number, signal: AbortSignal) => {
    const { promise, resolve } = Promise.withResolvers<{ exitCode: number; output: string }>();
    const release = (output = "0 errors\n") => resolve({ exitCode: 0, output });
    signal.addEventListener("abort", () => resolve({ exitCode: 1, output: "aborted" }));
    calls.push({ command, release, signal });
    return promise;
  };
  return { calls, runCommand };
}

type TaskInput = Parameters<orchestratorTypes.Orchestrator["createTask"]>[0];

const lintTaskOf = (
  checks: NonNullable<TaskInput["checks"]>,
  overrides: Partial<TaskInput> = {},
): TaskInput => ({
  checks,
  currentState: "lint reports 3 errors",
  goalState: "lint reports 0 errors",
  title: "lint",
  ...overrides,
});

const inCheckedRepository = <A, E>(
  body: (context: ReturnType<typeof setup>) => Effect.Effect<A, E>,
  options: orchestratorHarnessTypes.HarnessOptions = {},
) =>
  Effect.runPromise(
    withRepository((directory) =>
      Effect.suspend(() =>
        body(setup({ runCommand: orchestratorCallbacks.runCommand, ...options, cwd: directory })),
      ),
    ),
  );

const inHeldRepository = <A, E>(
  body: (
    context: ReturnType<typeof setup> & { held: ReturnType<typeof heldCommand> },
  ) => Effect.Effect<A, E>,
) => {
  const held = heldCommand();
  return inCheckedRepository((context) => body({ ...context, held }), {
    runCommand: held.runCommand,
  });
};

const goalChecksSupport = {
  LINT_CHECK,
  SHORTCUT_CHECK,
  heldCommand,
  inCheckedRepository,
  inHeldRepository,
  lintTaskOf,
  withRepo,
  withRepository,
};

export default goalChecksSupport;
