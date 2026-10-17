import { existsSync, readFileSync } from "node:fs";
import { access, chmod } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import {
  removeTempDir,
  chmodRestorePaths,
  tempDirs,
  createTempDir,
  abortedContext,
  collectShellOutput,
  toBashSingleQuotedArg,
} from "./env-node-support.ts";

afterEach(async () => {
  vi.restoreAllMocks();
  for await (const path of chmodRestorePaths.splice(0)) {
    try {
      await access(path);
      await chmod(path, 0o700);
    } catch {}
  }
  for await (const dir of tempDirs.splice(0)) await removeTempDir(dir);
}, 15_000);

function fakeWindowsShell() {
  const root = createTempDir();
  const pidFile = join(root, "shell.pid");
  const controller = new AbortController();
  const env = new NodeExecutionEnv({ cwd: root, shellPath: "/bin/bash" });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const previousSystemRoot = process.env["SystemRoot"];
  process.env["SystemRoot"] = "/definitely/missing/windows";
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  return { pidFile, controller, env, platformDescriptor, previousSystemRoot };
}

describe("NodeExecutionEnv shell", () => {
  it("streams combined stdout and stderr", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const collected = await collectShellOutput(
      env,
      "printf out; printf err >&2",
      undefined,
      BACKGROUND_CONTEXT,
    );
    expect(getOrThrow(collected.result)).toEqual({ exitCode: 0 });
    expect(collected.output).toContain("out");
    expect(collected.output).toContain("err");
  });

  it("decodes UTF-8 split across raw process chunks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const script =
      "const b=Buffer.from('😀');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),50)";
    const collected = await collectShellOutput(
      env,
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
      undefined,
      BACKGROUND_CONTEXT,
    );
    expect(collected.output).toBe("😀");
  }, 20_000);

  it("reports a missing working directory before spawning", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: join(root, "missing") });
    const result = await env.exec("printf ok", undefined, BACKGROUND_CONTEXT);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "spawn_error",
        message: expect.stringContaining("Working directory does not exist"),
      },
    });
  });

  it("returns non-zero command exit codes as successful execution results", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = getOrThrow(await env.exec("exit 7", undefined, BACKGROUND_CONTEXT));
    expect(result).toEqual({ exitCode: 7 });
  });
});

describe("NodeExecutionEnv shell", () => {
  // Regression test for https://github.com/earendil-works/pi/issues/8992
  it.skipIf(process.platform === "win32")(
    "maps signal-killed processes to a non-zero exit code",
    async () => {
      const root = createTempDir();
      const env = new NodeExecutionEnv({ cwd: root });
      const result = getOrThrow(await env.exec("kill -9 $$", undefined, BACKGROUND_CONTEXT));
      expect(result.exitCode).toBe(128 + 9);
    },
  );

  it("returns timeout errors for commands exceeding the timeout", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = await env.exec("sleep 5", { timeout: 0.01 }, BACKGROUND_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "timeout" });
  });

  it("rejects invalid timeouts before spawning", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    for await (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_484]) {
      expect(await env.exec("touch spawned", { timeout }, BACKGROUND_CONTEXT)).toMatchObject({
        ok: false,
        error: { code: "timeout", message: expect.stringContaining("Invalid timeout") },
      });
    }
    expect(getOrThrow(await env.exists("spawned", BACKGROUND_CONTEXT))).toBe(false);
  });

  it("returns callback errors from exec stream handlers", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = await env.exec(
      "printf out",
      {
        onOutput: () => {
          throw new Error("callback failed");
        },
      },
      BACKGROUND_CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ code: "callback_error", message: "callback failed" });
  });
});

describe("NodeExecutionEnv shell", () => {
  it("returns shell unavailable and spawn errors", async () => {
    const root = createTempDir();
    const missingShellEnv = new NodeExecutionEnv({
      cwd: root,
      shellPath: join(root, "missing-shell"),
    });
    const missingShell = await missingShellEnv.exec("printf ok", undefined, BACKGROUND_CONTEXT);
    expect(missingShell.ok).toBe(false);
    if (!missingShell.ok) expect(missingShell.error).toMatchObject({ code: "shell_unavailable" });

    const shellPath = join(root, "not-executable-shell");
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile(shellPath, "not executable", BACKGROUND_CONTEXT));
    const spawnErrorEnv = new NodeExecutionEnv({ cwd: root, shellPath });
    const spawnError = await spawnErrorEnv.exec("printf ok", undefined, BACKGROUND_CONTEXT);
    expect(spawnError.ok).toBe(false);
    if (!spawnError.ok) expect(spawnError.error).toMatchObject({ code: "spawn_error" });
  });

  it("returns an aborted result for pre-aborted and aborted commands", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    expect(await env.exec("touch spawned", undefined, abortedContext())).toMatchObject({
      ok: false,
      error: { code: "aborted" },
    });
    expect(getOrThrow(await env.exists("spawned", BACKGROUND_CONTEXT))).toBe(false);

    const controller = new AbortController();
    const promise = env.exec(
      "sleep 5",
      undefined,
      withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
    );
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "aborted" });
  });
});

describe("NodeExecutionEnv shell", () => {
  it.skipIf(process.platform === "win32")(
    "ignores asynchronous taskkill spawn errors during abort",
    async () => {
      const { pidFile, controller, env, platformDescriptor, previousSystemRoot } =
        fakeWindowsShell();

      let pid: number | undefined;
      try {
        const execution = env.exec(
          `echo $$ > ${toBashSingleQuotedArg(pidFile)}; exec sleep 60`,
          undefined,
          withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
        );
        const written = async (attempt: number): Promise<void> => {
          if (attempt >= 100 || existsSync(pidFile)) return;
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });
          await written(attempt + 1);
        };
        await written(0);
        expect(existsSync(pidFile)).toBe(true);

        controller.abort();
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
        process.kill(pid, "SIGKILL");

        const result = await execution;
        expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
      } finally {
        if (pid === undefined && existsSync(pidFile)) {
          pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
        }
        if (pid !== undefined && Number.isFinite(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
        if (previousSystemRoot === undefined) delete process.env["SystemRoot"];
        else process.env["SystemRoot"] = previousSystemRoot;
        if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
      }
    },
  );
});

describe("NodeExecutionEnv shell", () => {
  it("does not create a spill before output crosses its thresholds", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = getOrThrow(
      await env.exec(
        "printf short",
        {
          spill: { afterBytes: 100, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    );
    expect(result.spillPath).toBeUndefined();
  });

  it("preserves exact raw bytes in the spill while streaming decoded text", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const expected = [0x66, 0x80, 0x00, 0x6f];
    const result = getOrThrow(
      await env.exec(
        `${JSON.stringify(process.execPath)} -e "process.stdout.write(Buffer.from([${expected.join(",")}]))"`,
        {
          spill: { afterBytes: 1, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    );
    expect(result.spillPath).toBeDefined();
    tempDirs.push(join(result.spillPath!, ".."));
    expect([
      ...getOrThrow(await env.readBinaryFile(result.spillPath!, BACKGROUND_CONTEXT)),
    ]).toEqual(expected);
  }, 20_000);
});
