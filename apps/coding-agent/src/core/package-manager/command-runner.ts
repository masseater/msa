import * as Effect from "effect/Effect";

import childProcess from "../../utils/child-process.ts";
import outputGuard from "../output-guard.ts";
import platformModule from "../platform/index.ts";
import type nodeChildProcessTypes from "../platform/node/child-process.types.ts";
import type nodeStreamTypes from "../platform/node/stream.types.ts";
import packageEnv from "./package-env.ts";

const { getEnv } = packageEnv;
const { isStdoutTakenOver } = outputGuard;
const { schedule } = platformModule;

function runCommandSync(command: string, args: string[]): string {
  const env = getEnv();
  const result = childProcess.spawnProcessSync(command, args, {
    encoding: "utf-8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `Failed to run ${command} ${args.join(" ")}: ${result.error?.message || result.stderr || result.stdout}`,
    );
  }
  return (result.stdout || result.stderr || "").trim();
}

function spawnCommand(
  command: string,
  args: string[],
  options?: { cwd?: string },
): nodeChildProcessTypes.ChildProcess {
  const env = getEnv();
  return childProcess.spawnProcess(command, args, {
    cwd: options?.cwd,
    env,
    stdio: isStdoutTakenOver() ? ["ignore", 2, 2] : "inherit",
  });
}

function runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
  return Effect.runPromise(
    Effect.callback<void>((resume) => {
      const child = spawnCommand(command, args, options);
      child.on("error", (error) => {
        resume(Effect.die(error));
      });
      child.on("exit", (code) => {
        if (code === 0) {
          resume(Effect.void);
        } else {
          resume(Effect.die(new Error(`${command} ${args.join(" ")} failed with code ${code}`)));
        }
      });
    }),
  );
}

function spawnCaptureCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): nodeChildProcessTypes.ChildProcessByStdio<
  null,
  nodeStreamTypes.Readable,
  nodeStreamTypes.Readable
> {
  const baseEnv = getEnv();
  const env = options?.env === undefined ? baseEnv : { ...baseEnv, ...options.env };
  return childProcess.spawnProcess(command, args, {
    cwd: options?.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

type CaptureOptions = { cwd?: string; timeoutMs?: number; env?: Record<string, string> };

function captureFailure(
  command: string,
  args: string[],
  outcome: { code: number | null; signal: string | null; stdout: string; stderr: string },
): Error {
  const { code, signal, stdout, stderr } = outcome;
  const exitStatus = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
  return new Error(`${command} ${args.join(" ")} failed with ${exitStatus}: ${stderr || stdout}`);
}

function runCommandCapture(
  command: string,
  args: string[],
  options?: CaptureOptions,
): Promise<string> {
  return Effect.runPromise(
    Effect.callback<string>((resume) => {
      const child = spawnCaptureCommand(command, args, options);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeout =
        typeof options?.timeoutMs === "number"
          ? schedule(() => {
              timedOut = true;
              child.kill();
            }, options.timeoutMs)
          : undefined;
      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      child.once("error", (error) => {
        timeout?.cancel();
        resume(Effect.die(error));
      });
      child.once("close", (code, signal) => {
        timeout?.cancel();
        if (timedOut) {
          const message = `${command} ${args.join(" ")} timed out after ${options?.timeoutMs}ms`;
          resume(Effect.die(new Error(message)));
        } else if (code === 0) {
          resume(Effect.succeed(stdout.trim()));
        } else {
          resume(Effect.die(captureFailure(command, args, { code, signal, stderr, stdout })));
        }
      });
    }),
  );
}

const commandRunner = { runCommand, runCommandCapture, runCommandSync };

export default commandRunner;
