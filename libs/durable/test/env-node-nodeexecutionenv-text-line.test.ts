import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, chmod, realpath } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import {
  removeTempDir,
  chmodRestorePaths,
  tempDirs,
  createTempDir,
  collectShellOutput,
  toBashSingleQuotedArg,
} from "./env-node-support.ts";

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`Condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    await poll();
  };
  await poll();
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function createInheritedStdioCommand(pidFile: string): string {
  return (
    'node -e "' +
    "const fs=require('fs');" +
    "const {spawn}=require('child_process');" +
    "const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});" +
    "fs.writeFileSync(process.argv[1], String(child.pid));" +
    "child.unref();" +
    "console.log('child-exiting');" +
    '" ' +
    toBashSingleQuotedArg(pidFile)
  );
}

function cleanupDetachedChild(pidFile: string): void {
  if (!existsSync(pidFile)) return;
  const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
  } catch {}
}

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

describe("NodeExecutionEnv text line reader", () => {
  it("rejects reads after close and closes idempotently", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("lines.txt", "one\n", BACKGROUND_CONTEXT));
    const reader = getOrThrow(await env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT));
    await reader.close(BACKGROUND_CONTEXT);
    await expect(reader.close(BACKGROUND_CONTEXT)).resolves.toBeUndefined();
    expect(await reader.readLine(BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "invalid", path: join(root, "lines.txt") },
    });
  });

  it("reports missing files when opening a reader", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    expect(await env.openTextLineReader("missing.txt", BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "not_found", path: join(root, "missing.txt") },
    });
  });
});

describe("NodeExecutionEnv shell", () => {
  it("executes commands in cwd with env overrides", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const collected = await collectShellOutput(
      env,
      'printf \'%s\' "$NODE_ENV_TEST" > cwd-marker.txt; printf \'%s:%s\' "$PWD" "$NODE_ENV_TEST"',
      { env: { NODE_ENV_TEST: "ok" } },
      BACKGROUND_CONTEXT,
    );
    const result = getOrThrow(collected.result);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, "cwd-marker.txt"), "utf8")).toBe("ok");
    // Git Bash on Windows reports $PWD as an MSYS path (/tmp/...), not the Windows path.
    if (process.platform !== "win32") expect(collected.output).toBe(`${await realpath(root)}:ok`);
  });

  it.each([
    ["a missing override preserves the base value", undefined, "x:/stale/parent.jsonl"],
    ["an empty override shadows the base value", { MSA_SESSION_FILE: "" }, "x:"],
    [
      "a string override replaces the base value",
      { MSA_SESSION_FILE: "/sessions/current.jsonl" },
      "x:/sessions/current.jsonl",
    ],
  ] as const)(
    "applies string shell environment overrides when %s",
    async (_description, overrides, expectedSessionFile) => {
      const root = createTempDir();
      const env = new NodeExecutionEnv({
        cwd: root,
        shellEnv: {
          MSA_SESSION_FILE: "/stale/parent.jsonl",
          MSA_CODING_AGENT: "true",
          MSA_NODE_ENV_PRESERVED_TEST: "preserved",
        },
      });
      const collected = await collectShellOutput(
        env,
        `printf '%s:%s|%s|%s' "\${MSA_SESSION_FILE+x}" "\${MSA_SESSION_FILE-}" "$MSA_CODING_AGENT" "$MSA_NODE_ENV_PRESERVED_TEST"`,
        overrides === undefined ? {} : { env: overrides },
        BACKGROUND_CONTEXT,
      );
      getOrThrow(collected.result);
      expect(collected.output).toBe(`${expectedSessionFile}|true|preserved`);
    },
  );
});

describe("NodeExecutionEnv shell", () => {
  it("can replace rather than inherit the default shell environment", async () => {
    const root = createTempDir();
    const inheritedKey = "MSA_NODE_ENV_INHERITED_TEST";
    const configuredKey = "MSA_NODE_ENV_CONFIGURED_TEST";
    const explicitKey = "MSA_NODE_ENV_EXPLICIT_TEST";
    const previousInherited = process.env[inheritedKey];
    process.env[inheritedKey] = "host";
    try {
      const env = new NodeExecutionEnv({ cwd: root, shellEnv: { [configuredKey]: "configured" } });
      const collected = await collectShellOutput(
        env,
        `printf '%s:%s:%s' "\${${inheritedKey}-}" "\${${configuredKey}-}" "\${${explicitKey}-}"`,
        { inheritEnv: false, env: { [explicitKey]: "explicit" } },
        BACKGROUND_CONTEXT,
      );
      getOrThrow(collected.result);
      expect(collected.output).toBe("::explicit");
    } finally {
      if (previousInherited === undefined) delete process.env[inheritedKey];
      else process.env[inheritedKey] = previousInherited;
    }
  });
});

describe("NodeExecutionEnv shell", () => {
  it("uses stdin command transport for legacy WSL bash paths", async () => {
    if (process.platform === "win32") return;
    const root = createTempDir();
    const shellPath = "C:\\Windows\\System32\\bash.exe";
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(
      await env.writeFile(
        shellPath,
        '#!/bin/sh\nprintf \'args:%s\\n\' "$*" >&2\nexec /bin/bash "$@"\n',
        BACKGROUND_CONTEXT,
      ),
    );
    await chmod(join(root, shellPath), 0o755);

    const originalCwd = process.cwd();
    const originalPath = process.env["PATH"];
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    try {
      process.chdir(root);
      process.env["PATH"] = `${root}${delimiter}${originalPath ?? ""}`;
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: "win32",
      });

      const wslEnv = new NodeExecutionEnv({ cwd: root, shellPath });
      const nameExpansion = "${name}";
      const collected = await collectShellOutput(
        wslEnv,
        `name='World'; echo "Hello, ${nameExpansion}!"`,
        undefined,
        BACKGROUND_CONTEXT,
      );
      const result = getOrThrow(collected.result);
      expect(collected.output).toContain("Hello, World!");
      expect(collected.output).toContain("args:-s");
      expect(result.exitCode).toBe(0);
    } finally {
      process.chdir(originalCwd);
      process.env["PATH"] = originalPath;
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor);
      }
    }
  });
});

describe("NodeExecutionEnv shell", () => {
  it.skipIf(process.platform !== "win32")(
    "settles after the shell exits when a detached descendant retains inherited stdio",
    async () => {
      const root = createTempDir();
      const pidFile = join(root, "grandchild.pid");
      const env = new NodeExecutionEnv({ cwd: root });
      const controller = new AbortController();
      try {
        const collected = await withTimeout(
          collectShellOutput(
            env,
            createInheritedStdioCommand(pidFile),
            undefined,
            withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
          ),
          3000,
          () => controller.abort(),
        );
        getOrThrow(collected.result);
        expect(collected.output).toContain("child-exiting");
      } finally {
        controller.abort();
        cleanupDetachedChild(pidFile);
      }
    },
  );

  it("cleanup terminates active shell processes", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const execution = env.exec("touch started; sleep 60", undefined, BACKGROUND_CONTEXT);
    try {
      await waitFor(
        async () => getOrThrow(await env.exists("started", BACKGROUND_CONTEXT)),
        10_000,
      );
    } finally {
      await env.cleanup(BACKGROUND_CONTEXT);
    }
    await expect(withTimeout(execution, 3000)).resolves.toMatchObject({ ok: true });
  }, 20_000);
});
