import testing from "@msa/testing";
import { Effect } from "effect";

const { makeTempDir, removePath } = testing;

const LINT_CHECK = { command: "cat lint.txt", output: "^0 errors$" };
const SHORTCUT_CHECK = { command: "grep -c 'layer-[0-9]' src.txt", exitCode: 1 };

function withRepo<A, E>(body: (directory: string) => Effect.Effect<A, E>): Effect.Effect<A, E> {
  return Effect.acquireUseRelease(makeTempDir("msa-goal-checks-"), body, (directory) =>
    removePath(directory),
  );
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

const goalChecksSupport = { LINT_CHECK, SHORTCUT_CHECK, heldCommand, withRepo };

export default goalChecksSupport;
