import type chordTypes from "@msa/chord/index.types";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import envModule from "../src/env/index.ts";
import type envTypes from "../src/env/index.types.ts";
import durableKit from "./durable-kit.ts";
import support from "./support.ts";
import toolsSupport from "./tools-support.ts";
import toolsTimeoutEnvSupport from "./tools-timeout-env-support.ts";

const { envNode: node, tools: toolsModule, truncate } = durableKit;

const { NodeExecutionEnv } = node;
const { createBashTool, createPowerShellTool } = toolsModule;
const { getOrThrow } = envModule;
const { DEFAULT_MAX_LINES } = truncate;

const { BACKGROUND_CONTEXT, abortController, awaited, withAbortSignal } = support;
const { createEnv, createTempDir, fakeApi, removeTempDirs, run, runFailing } = toolsSupport;
const { TRUNCATED_OUTPUT_LINES, TimeoutOutputExecutionEnv } = toolsTimeoutEnvSupport;

afterAll(() => Effect.runPromise(removeTempDirs));

const passesRetainedWindow = Effect.gen(function* () {
  const window: envTypes.ShellOutputWindow = {
    bytesPerSecond: 1024,
    maxBytes: 4,
    maxLines: 1,
    minIntervalMs: 100,
  };
  const skipped: envTypes.ShellOutputSkip = { bytes: 6, endsWithNewline: true, newlines: 2 };
  let received: envTypes.ShellOutputWindow | undefined;
  class SkippingEnv extends NodeExecutionEnv {
    override exec(
      _command: string | readonly string[],
      options: envTypes.ShellExecOptions | undefined,
      context: chordTypes.Context,
    ): Promise<envTypes.Result<envTypes.ShellExecResult, envTypes.ExecutionError>> {
      received = options?.window;
      options?.onOutput?.("tail\n", context, { skipped, stream: "stdout" });
      return Promise.resolve({ ok: true, value: { exitCode: 0 } });
    }
  }
  const calls: [string, envTypes.ShellOutputSkip | undefined][] = [];
  const api = {
    ...fakeApi(new SkippingEnv({ cwd: yield* createTempDir })).api,
    output: (chunk: string | Uint8Array, skip?: envTypes.ShellOutputSkip) =>
      calls.push([String(chunk), skip]),
    outputWindow: window,
  } as durableTypes.ToolExecutionApi;
  yield* awaited(createBashTool().execute({ command: "anything" }, api, BACKGROUND_CONTEXT));
  expect(received).toEqual(window);
  expect(calls).toEqual([["tail\n", skipped]]);
});

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
      Effect.runPromise(passesRetainedWindow));
  });
});

const streamsCombinedStdout = Effect.gen(function* () {
  const result = yield* awaited(
    run(createBashTool(), { command: "printf out; printf err >&2" }, yield* createEnv),
  );
  expect(result.streamed.join("")).toContain("out");
  expect(result.streamed.join("")).toContain("err");
  expect(result.output).toBeUndefined();
  expect(result.structuredOutput).toEqual({
    exitCode: 0,
    output: result.streamed.join(""),
    truncated: false,
  });
});

const answersNonzeroExit = Effect.gen(function* () {
  const env = yield* createEnv;
  const tool = createBashTool();
  const failed = yield* awaited(run(tool, { command: "printf failed; exit 7" }, env));
  expect(failed).toMatchObject({
    diagnostics: [{ code: "exit_code", message: "Command exited with code 7" }],
    isError: true,
    structuredOutput: { exitCode: 7, output: "failed", truncated: false },
  });
  expect(failed.streamed.join("")).toBe("failed");
  const slow = yield* runFailing(tool, { command: "sleep 2", timeout: 0.01 }, env);
  expect(slow.error.message).toBe("Command timed out after 0.01 seconds");
});

const reportsSpillCommand = Effect.gen(function* () {
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
});

describe("durable tools", () => {
  describe("bash", () => {
    it("streams combined stdout and stderr, returns no output of its own, and repeats it with the exit code", () =>
      Effect.runPromise(streamsCombinedStdout));

    it("answers a nonzero exit with an error result, and throws on a timeout, after streaming the output", () =>
      Effect.runPromise(answersNonzeroExit));

    it("reports the spill of a command that times out", () =>
      Effect.runPromise(reportsSpillCommand));
  });
});

const preparesCommandCwd = Effect.gen(function* () {
  const env = new NodeExecutionEnv({
    cwd: yield* createTempDir,
    shellEnv: { MSA_BASH_PREPARE_INHERITED: "inherited" },
  });
  getOrThrow(yield* awaited(env.createDir("workspace", undefined, BACKGROUND_CONTEXT)));
  const workspace = `${env.cwd}/workspace`;
  const controller = abortController();
  let receivedEnv: envTypes.ExecutionEnv | undefined;
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
    run(tool, { command: ":" }, env, withAbortSignal(controller.signal, BACKGROUND_CONTEXT)),
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
});

describe("durable tools", () => {
  describe("bash", () => {
    it("prepares command, cwd, and an explicit environment with the call's api", () =>
      Effect.runPromise(preparesCommandCwd));
  });
});
