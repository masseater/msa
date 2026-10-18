import { spawn } from "node:child_process";

import * as Effect from "effect/Effect";

import { waitForChildProcess } from "../utils/child-process.ts";
import { awaited, awaiting } from "./awaiting.ts";

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
      return yield* awaited(
        new Promise((resolve) => {
          const proc = spawn(command, args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
          });

          let stdout = "";
          let stderr = "";
          let killed = false;
          let timeoutId: NodeJS.Timeout | undefined;

          const killProcess = () => {
            if (!killed) {
              killed = true;
              proc.kill("SIGTERM");
              setTimeout(() => {
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
            timeoutId = setTimeout(() => {
              killProcess();
            }, options.timeout);
          }

          proc.stdout?.on("data", (data) => {
            stdout += data.toString();
          });

          proc.stderr?.on("data", (data) => {
            stderr += data.toString();
          });

          waitForChildProcess(proc)
            .then((code) => {
              if (timeoutId !== undefined) clearTimeout(timeoutId);
              if (options?.signal !== undefined) {
                options.signal.removeEventListener("abort", killProcess);
              }
              resolve({ stdout, stderr, code: code ?? 0, killed });
            })
            .catch((_err) => {
              if (timeoutId !== undefined) clearTimeout(timeoutId);
              if (options?.signal !== undefined) {
                options.signal.removeEventListener("abort", killProcess);
              }
              resolve({ stdout, stderr, code: 1, killed });
            });
        }),
      );
    }),
  );
}
