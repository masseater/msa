import { spawn } from "node:child_process";

import { Config, ConfigProvider, Effect, Function, Option } from "effect";

import type dualTypes from "../../dual.ts";
import nodePaths from "./node-paths.ts";
import type nodeProcessTypes from "./node-process.types.ts";

const { joinPaths } = nodePaths;

const environmentVariable: dualTypes.Dual2<string, boolean, string | undefined> = Function.dual(
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
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.once("error", () => {});
  } catch {}
};

const killProcessTree = (pid: number): void => {
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

const spawnProcessGroup = ({
  program,
  args,
  cwd,
  env,
  pipeStdin,
}: nodeProcessTypes.SpawnRequest): nodeProcessTypes.OsProcess =>
  spawn(program, args, {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio: [pipeStdin ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true,
  });

const nodeProcess = {
  environmentVariable,
  killProcessTree,
  spawnProcessGroup,
};

export default nodeProcess;
