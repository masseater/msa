import { dual } from "effect/Function";

import { schedule } from "../core/platform.ts";
import { spawnProcess } from "./child-process.ts";
import { callbackPromise } from "./interop.ts";

function runClipboardCommandImpl(
  command: string,
  args: readonly string[],
  options?: { input?: string; timeoutMs?: number; maxBufferBytes?: number },
): Promise<Buffer | undefined> {
  return callbackPromise((resolve) => {
    const child = spawnProcess(command, [...args], {
      stdio: ["pipe", options?.input === undefined ? "pipe" : "ignore", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const finish = (result: Buffer | undefined): void => {
      if (settled) return;
      settled = true;
      timer.cancel();
      resolve(result);
    };
    const abort = (): void => {
      child.kill("SIGKILL");
      child.stdout?.destroy();
      child.stdin?.destroy();
      finish(undefined);
    };
    const timer = schedule(abort, options?.timeoutMs ?? 3000);
    child.on("error", () => finish(undefined));
    child.on("close", (code) => {
      if (!settled) finish(code === 0 ? Buffer.concat(chunks, length) : undefined);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      length += chunk.length;
      if (length > (options?.maxBufferBytes ?? 50 * 1024 * 1024)) abort();
      else chunks.push(chunk);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(options?.input);
  });
}

export const runClipboardCommand: {
  (
    command: string,
    args: readonly string[],
    options?: { input?: string; timeoutMs?: number; maxBufferBytes?: number },
  ): Promise<Buffer | undefined>;
  (
    args: readonly string[],
    options?: { input?: string; timeoutMs?: number; maxBufferBytes?: number },
  ): (command: string) => Promise<Buffer | undefined>;
} = dual((args: IArguments) => args.length >= 2, runClipboardCommandImpl);
