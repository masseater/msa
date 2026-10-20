import * as Effect from "effect/Effect";

import childProcess from "../utils/child-process.ts";
import awaitingModule from "./awaiting.ts";
import type execTypes from "./exec.types.ts";
import platform from "./platform.ts";
import type platformTypes from "./platform.types.ts";
import nodeChildProcess from "./platform/node/child-process.ts";

const { spawn } = nodeChildProcess;

const { awaiting, performed } = awaitingModule;
const { schedule } = platform;
const { waitForChildProcess } = childProcess;

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

          let stdout = "";
          let stderr = "";
          let killed = false;
          let timeoutId: platformTypes.Scheduled | undefined;

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
            resume(Effect.succeed({ code, killed, stderr, stdout }));
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

const exec = {
  execCommand,
};

export default exec;
