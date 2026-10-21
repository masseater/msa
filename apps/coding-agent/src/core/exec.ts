import * as Effect from "effect/Effect";

import childProcess from "../utils/child-process.ts";
import awaitingModule from "./awaiting.ts";
import type execTypes from "./exec.types.ts";
import platform from "./platform/index.ts";
import type platformTypes from "./platform/index.types.ts";
import nodeChildProcess from "./platform/node/child-process.ts";
import type nodeChildProcessTypes from "./platform/node/child-process.types.ts";

const { spawn } = nodeChildProcess;

const { awaiting, performed } = awaitingModule;
const { schedule, scheduleUnref } = platform;

const KILL_GRACE_MS = 5000;

const running = (proc: nodeChildProcessTypes.ChildProcess): boolean =>
  proc.exitCode === null && proc.signalCode === null;
const { waitForChildProcess } = childProcess;

function stopOnAbortOrTimeout(
  proc: nodeChildProcessTypes.ChildProcess,
  options: execTypes.ExecOptions | undefined,
) {
  let killed = false;
  let escalation: platformTypes.Scheduled | undefined;
  const kill = () => {
    if (killed) return;
    killed = true;
    proc.kill("SIGTERM");
    escalation = scheduleUnref(() => {
      if (running(proc)) proc.kill("SIGKILL");
    }, KILL_GRACE_MS);
  };
  const signal = options?.signal;
  if (signal?.aborted === true) kill();
  else signal?.addEventListener("abort", kill, { once: true });
  const timeout =
    options?.timeout !== undefined && options.timeout > 0
      ? schedule(kill, options.timeout)
      : undefined;
  return {
    dispose: () => {
      timeout?.cancel();
      escalation?.cancel();
      signal?.removeEventListener("abort", kill);
    },
    killed: () => killed,
  };
}

function collectOutput(proc: nodeChildProcessTypes.ChildProcess) {
  const output = { stderr: "", stdout: "" };
  proc.stdout?.on("data", (data) => {
    output.stdout += data.toString();
  });
  proc.stderr?.on("data", (data) => {
    output.stderr += data.toString();
  });
  return output;
}

function execCommand(
  command: string,
  args: string[],
  cwd: string,
  options?: execTypes.ExecOptions,
): Promise<execTypes.ExecResult> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* performed(
        Effect.callback<execTypes.ExecResult>((resume) => {
          const proc = spawn(command, args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
          });
          const stop = stopOnAbortOrTimeout(proc, options);
          const output = collectOutput(proc);
          const finish = (code: number) => {
            stop.dispose();
            resume(Effect.succeed({ code, killed: stop.killed(), ...output }));
            return undefined;
          };
          waitForChildProcess(proc).then(
            (code) => finish(code ?? 0),
            () => finish(1),
          );
        }),
      );
    }),
  );
}

const exec = {
  execCommand,
};

export default exec;
