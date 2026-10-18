import { spawn } from "node:child_process";

import * as Effect from "effect/Effect";

import { waitForChildProcess } from "../utils/child-process.ts";
import { awaiting, performed } from "./awaiting.ts";
import { schedule, type Scheduled } from "./platform.ts";

export interface ExecOptions {
  signal?: AbortSignal;
  timeout?: number;
  cwd?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

export function execCommand(
  command: string,
  args: string[],
  cwd: string,
  options?: ExecOptions,
): Promise<ExecResult> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* performed(
        Effect.callback<ExecResult>((resume) => {
          const proc = spawn(command, args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
          });

          let stdout = "";
          let stderr = "";
          let killed = false;
          let timeoutId: Scheduled | undefined;

          const killProcess = () => {
            if (!killed) {
              killed = true;
              proc.kill("SIGTERM");
              schedule(() => {
                if (!proc.killed) {
                  proc.kill("SIGKILL");
                }
              }, 5000);
            }
          };

          if (options?.signal !== undefined) {
            if (options.signal.aborted) {
              killProcess();
            } else {
              options.signal.addEventListener("abort", killProcess, { once: true });
            }
          }

          if (options?.timeout !== undefined && options?.timeout !== 0 && options.timeout > 0) {
            timeoutId = schedule(() => {
              killProcess();
            }, options.timeout);
          }

          proc.stdout?.on("data", (data) => {
            stdout += data.toString();
          });

          proc.stderr?.on("data", (data) => {
            stderr += data.toString();
          });

          const finish = (code: number) => {
            if (timeoutId !== undefined) timeoutId.cancel();
            if (options?.signal !== undefined) {
              options.signal.removeEventListener("abort", killProcess);
            }
            resume(Effect.succeed({ stdout, stderr, code, killed }));
          };
          waitForChildProcess(proc).then(
            (code) => {
              finish(code ?? 0);
              return undefined;
            },
            () => {
              finish(1);
              return undefined;
            },
          );
        }),
      );
    }),
  );
}
