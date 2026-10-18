import { type ChildProcess, spawn } from "node:child_process";

import { Config, ConfigProvider, Effect, Function, Option } from "effect";

import type { Dual2 } from "../dual.ts";
import { joinPaths } from "./node-paths.ts";

export const environmentVariable: Dual2<string, boolean, string | undefined> = Function.dual(
  2,
  (name: string, preserveEmptyStrings: boolean): string | undefined =>
    Effect.runSync(
      Config.option(Config.String(name))
        .parse(ConfigProvider.fromEnv({ preserveEmptyStrings }))
        .pipe(Effect.map(Option.getOrUndefined)),
    ),
);

const killWindowsTree = (pid: number): void => {
  try {
    const systemRoot = environmentVariable("SystemRoot", true) ?? "C:\\Windows";
    const child = spawn(
      joinPaths(systemRoot, "System32", "taskkill.exe"),
      ["/F", "/T", "/PID", String(pid)],
      { stdio: "ignore", detached: true, windowsHide: true },
    );
    child.once("error", () => {});
  } catch {}
};

export const killProcessTree = (pid: number): void => {
  if (process.platform === "win32") {
    killWindowsTree(pid);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
};

export type OsProcess = ChildProcess;

export interface SpawnRequest {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly pipeStdin: boolean;
}

export const spawnProcessGroup = ({
  program,
  args,
  cwd,
  env,
  pipeStdin,
}: SpawnRequest): OsProcess =>
  spawn(program, args, {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio: [pipeStdin ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true,
  });
