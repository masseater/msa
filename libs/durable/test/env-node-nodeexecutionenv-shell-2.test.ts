import { access, chmod } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import {
  removeTempDir,
  chmodRestorePaths,
  tempDirs,
  createTempDir,
  collectShellOutput,
} from "./env-node-support.ts";

class FailingSpillExecutionEnv extends NodeExecutionEnv {
  override createTempFile(
    options: Parameters<NodeExecutionEnv["createTempFile"]>[0],
    context: Parameters<NodeExecutionEnv["createTempFile"]>[1],
  ) {
    if (options?.prefix === "msa-output-") {
      return Promise.resolve({ ok: true as const, value: join(this.cwd, "missing", "spill.log") });
    }
    return Promise.resolve(super.createTempFile(options, context));
  }
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

describe("NodeExecutionEnv shell", () => {
  it("reports the spill of a command that times out", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = await env.exec(
      "printf 12345678901234567890; sleep 5",
      { timeout: 0.3, spill: { afterBytes: 10, afterLines: 10 } },
      BACKGROUND_CONTEXT,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "timeout", spillPath: expect.any(String) },
    });
    const spillPath = (result as { error: { spillPath: string } }).error.spillPath;
    tempDirs.push(join(spillPath, ".."));
    expect(getOrThrow(await env.readTextFile(spillPath, BACKGROUND_CONTEXT))).toBe(
      "12345678901234567890",
    );
  });

  it("fails rather than silently losing a requested spill", async () => {
    const root = createTempDir();
    const env = new FailingSpillExecutionEnv({ cwd: root });
    const result = await env.exec(
      "printf 12345678901234567890",
      {
        spill: { afterBytes: 10, afterLines: 10 },
      },
      BACKGROUND_CONTEXT,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unknown",
        message: expect.stringContaining("Failed to preserve complete shell output"),
      },
    });
  });
});

describe("NodeExecutionEnv shell", () => {
  it("preserves complete large output in the spill", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const size = 500_000;
    const result = getOrThrow(
      await env.exec(
        `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(${size}))"`,
        {
          spill: { afterBytes: 10, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    );
    expect(result.spillPath).toBeDefined();
    tempDirs.push(join(result.spillPath!, ".."));
    expect(getOrThrow(await env.readTextFile(result.spillPath!, BACKGROUND_CONTEXT))).toHaveLength(
      size,
    );
  }, 20_000);

  it("streams every line and spills them all once output crosses its line threshold", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const collected = await collectShellOutput(
      env,
      "i=1; while [ $i -le 15000 ]; do echo line-$i; i=$((i+1)); done",
      { spill: { afterBytes: 1024 * 1024, afterLines: 100 } },
      BACKGROUND_CONTEXT,
    );
    const result = getOrThrow(collected.result);
    expect(collected.output).toBe(
      Array.from({ length: 15000 }, (_, index) => `line-${index + 1}\n`).join(""),
    );
    expect(result.spillPath).toBeDefined();
    tempDirs.push(join(result.spillPath!, ".."));
    const spilled = getOrThrow(
      await env.readTextLines(result.spillPath!, undefined, BACKGROUND_CONTEXT),
    );
    expect(spilled).toHaveLength(15000);
    expect(spilled.at(-1)).toBe("line-15000");
  });
});
