import { mkdirSync, rmSync } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";

import { type ShellExecOptions } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";

export const tempDirs: string[] = [];

export const chmodRestorePaths: string[] = [];

export function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `msa-durable-env-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

// Remove a test directory. On Windows, `taskkill /T` runs asynchronously and can miss descendants such as Git Bash's
// `sleep`, so a killed command's processes can hold the directory for a while after `exec` settles; retry until they
// exit.
export async function removeTempDir(dir: string, attempt = 0): Promise<void> {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (attempt >= 80 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY"))
      throw error;
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    await removeTempDir(dir, attempt + 1);
  }
}

export function abortedContext() {
  const controller = new AbortController();
  controller.abort();
  return withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
}

export async function fileHandlePrototype(path: string): Promise<FileHandle> {
  const handle = await open(path, "r");
  await handle.close();
  return Object.getPrototypeOf(handle) as FileHandle;
}

export async function collectShellOutput(
  env: NodeExecutionEnv,
  command: string,
  options: ShellExecOptions | undefined,
  context: Parameters<NodeExecutionEnv["exec"]>[2],
): Promise<{ result: Awaited<ReturnType<NodeExecutionEnv["exec"]>>; output: string }> {
  let output = "";
  const result = await env.exec(
    command,
    {
      ...options,
      onOutput: (text) => {
        output += text;
      },
    },
    context,
  );
  return { result, output };
}

export function toBashSingleQuotedArg(value: string): string {
  return `'${value.replace(/\\/gu, "/").replace(/'/gu, `'"'"'`)}'`;
}
