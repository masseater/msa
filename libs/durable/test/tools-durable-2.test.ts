import type { Context } from "@msa/chord";
import type { ToolExecutionApi } from "@msa/durable";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import {
  type ExecutionEnv,
  ExecutionError,
  getOrThrow,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type ShellOutputSkip,
  type ShellOutputWindow,
} from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { createBashTool, createPowerShellTool } from "../src/tools/index.ts";
import { DEFAULT_MAX_LINES } from "../src/truncate.ts";
import { BACKGROUND_CONTEXT, withAbortSignal, abortController, awaited } from "./support.ts";
import {
  createEnv,
  createTempDir,
  run,
  fakeApi,
  runFailing,
  removeTempDirs,
} from "./tools-support.ts";
import { TRUNCATED_OUTPUT_LINES, TimeoutOutputExecutionEnv } from "./tools-timeout-env-support.ts";

afterAll(() => Effect.runPromise(removeTempDirs));

describe("durable tools", () => {
  describe("powershell", () => {
    it.runIf(process.platform === "win32")("runs real PowerShell with UTF-8 output", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* awaited(
            run(
              createPowerShellTool(),
              { command: "Write-Output ('h' + [char]0xe9 + 'llo'); exit 0" },
              yield* createEnv,
            ),
          );
          expect(result.streamed.join("").trim()).toBe("héllo");
        }),
      ),
    );
  });

  describe("bash", () => {
    it("passes the retained window to the environment and forwards what it skipped", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const window: ShellOutputWindow = {
            maxBytes: 4,
            maxLines: 1,
            minIntervalMs: 100,
            bytesPerSecond: 1024,
          };
          const skipped: ShellOutputSkip = { bytes: 6, newlines: 2, endsWithNewline: true };
          let received: ShellOutputWindow | undefined;
          class SkippingEnv extends NodeExecutionEnv {
            override exec(
              _command: string | readonly string[],
              options: ShellExecOptions | undefined,
              context: Context,
            ): Promise<Result<ShellExecResult, ExecutionError>> {
              received = options?.window;
              options?.onOutput?.("tail\n", context, { stream: "stdout", skipped });
              return Promise.resolve({ ok: true, value: { exitCode: 0 } });
            }
          }
          const calls: [string, ShellOutputSkip | undefined][] = [];
          const api = {
            ...fakeApi(new SkippingEnv({ cwd: yield* createTempDir })).api,
            outputWindow: window,
            output: (chunk: string | Uint8Array, skip?: ShellOutputSkip) =>
              calls.push([String(chunk), skip]),
          } as ToolExecutionApi;
          yield* awaited(
            createBashTool().execute({ command: "anything" }, api, BACKGROUND_CONTEXT),
          );
          expect(received).toEqual(window);
          expect(calls).toEqual([["tail\n", skipped]]);
        }),
      ));
  });
});

describe("durable tools", () => {
  describe("bash", () => {
    it("streams combined stdout and stderr, returns no output of its own, and repeats it with the exit code", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* awaited(
            run(createBashTool(), { command: "printf out; printf err >&2" }, yield* createEnv),
          );
          expect(result.streamed.join("")).toContain("out");
          expect(result.streamed.join("")).toContain("err");
          expect(result.output).toBeUndefined();
          expect(result.structuredOutput).toEqual({
            output: result.streamed.join(""),
            truncated: false,
            exitCode: 0,
          });
        }),
      ));

    it("answers a nonzero exit with an error result, and throws on a timeout, after streaming the output", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const env = yield* createEnv;
          const tool = createBashTool();
          const failed = yield* awaited(run(tool, { command: "printf failed; exit 7" }, env));
          expect(failed).toMatchObject({
            isError: true,
            structuredOutput: { output: "failed", truncated: false, exitCode: 7 },
            diagnostics: [{ code: "exit_code", message: "Command exited with code 7" }],
          });
          expect(failed.streamed.join("")).toBe("failed");
          const slow = yield* runFailing(tool, { command: "sleep 2", timeout: 0.01 }, env);
          expect(slow.error.message).toBe("Command timed out after 0.01 seconds");
        }),
      ));

    it("reports the spill of a command that times out", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const env = new TimeoutOutputExecutionEnv({ cwd: yield* createTempDir });
          const failed = yield* runFailing(
            createBashTool(),
            { command: "emit-output-then-time-out", timeout: 0.05 },
            env,
          );
          expect(failed.error.message).toBe("Command timed out after 0.05 seconds");
          const fullOutputPath = failed.reported[0]?.message.match(/^Full output: (.+)$/u)?.[1];
          expect(fullOutputPath).toBeDefined();
          const fullOutput = getOrThrow(
            yield* awaited(env.readTextFile(fullOutputPath!, BACKGROUND_CONTEXT)),
          );
          expect(fullOutput).toContain("line-1\nline-2");
          expect(fullOutput).toContain(`line-${DEFAULT_MAX_LINES}\nline-${TRUNCATED_OUTPUT_LINES}`);
        }),
      ));
  });
});

describe("durable tools", () => {
  describe("bash", () => {
    it("prepares command, cwd, and an explicit environment with the call's api", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const env = new NodeExecutionEnv({
            cwd: yield* createTempDir,
            shellEnv: { MSA_BASH_PREPARE_INHERITED: "inherited" },
          });
          getOrThrow(yield* awaited(env.createDir("workspace", undefined, BACKGROUND_CONTEXT)));
          const workspace = `${env.cwd}/workspace`;
          const controller = abortController();
          let receivedEnv: ExecutionEnv | undefined;
          let receivedSignal: AbortSignal | undefined;
          const tool = createBashTool({
            commandPrefix: "prefix=ready",
            prepare: (execution, api, callContext) => {
              receivedEnv = api.env;
              receivedSignal = callContext.abortSignal;
              execution.cwd = workspace;
              execution.env = { MSA_BASH_PREPARE_EXPLICIT: "explicit" };
              execution.inheritEnv = false;
              execution.command += `\n: > prepared-cwd\nprintf '%s:%s:%s' "$prefix" "\${MSA_BASH_PREPARE_INHERITED-}" "$MSA_BASH_PREPARE_EXPLICIT"`;
              if (process.platform !== "win32") execution.command += `\nprintf ':%s' "$PWD"`;

              return Promise.resolve();
            },
          });
          const result = yield* awaited(
            run(
              tool,
              { command: ":" },
              env,
              withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
            ),
          );
          expect(receivedEnv).toBe(env);
          expect(receivedSignal).toBe(controller.signal);
          const pwd =
            process.platform === "win32"
              ? ""
              : `:${getOrThrow(yield* awaited(env.canonicalPath(workspace, BACKGROUND_CONTEXT)))}`;
          expect(result.streamed.join("")).toBe(`ready::explicit${pwd}`);
          expect(
            getOrThrow(yield* awaited(env.exists(`${workspace}/prepared-cwd`, BACKGROUND_CONTEXT))),
          ).toBe(true);
        }),
      ));
  });
});
