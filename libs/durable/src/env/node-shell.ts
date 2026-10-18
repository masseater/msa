import { Effect, FileSystem, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { nodeRuntime } from "../node-runtime.ts";
import { ExecutionError } from "./execution-error.ts";
import { environmentVariable } from "./node-process.ts";
import { err, ok, type Result } from "./result.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
const LOOKUP_TIMEOUT_MS = 5000;

export const resolveTimeoutMs = (
  timeout: number | undefined,
): Result<number | undefined, ExecutionError> => {
  if (timeout === undefined) return ok(undefined);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return err(
      new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"),
    );
  }
  const timeoutMs = timeout * 1000;
  if (timeoutMs > MAX_TIMEOUT_MS) {
    return err(
      new ExecutionError("timeout", `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`),
    );
  }
  return ok(timeoutMs);
};

export interface ShellConfig {
  shell: string;
  args: string[];
  commandTransport?: "argv" | "stdin";
}

const pathExists = (path: string) =>
  FileSystem.FileSystem.use((fs) => fs.access(path)).pipe(
    Effect.as(true),
    Effect.catchCause(() => Effect.succeed(false)),
  );

const firstLineOf = Effect.fnUntraced(function* (command: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, [...args], {
          stdin: "ignore",
          stderr: "ignore",
          windowsHide: true,
        }),
      );
      const [stdout, status] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
        { concurrency: 2 },
      );
      return status === 0 ? stdout.trim().split(/\r?\n/u)[0] : undefined;
    }),
  );
  return yield* output.pipe(
    Effect.timeoutOption(LOOKUP_TIMEOUT_MS),
    Effect.catchCause(() => Effect.succeedNone),
    Effect.map(Option.getOrUndefined),
  );
});

const findBashOnPath = Effect.fnUntraced(function* () {
  const firstMatch =
    process.platform === "win32"
      ? yield* firstLineOf("where", ["bash.exe"])
      : yield* firstLineOf("which", ["bash"]);
  if (firstMatch === undefined || firstMatch === "") return undefined;
  return (yield* pathExists(firstMatch)) ? firstMatch : undefined;
});

const isLegacyWslBashPath = (path: string): boolean => {
  const normalized = path.replace(/\//gu, "\\").toLowerCase();
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/u.test(normalized);
};

const bashShellConfig = (shell: string): ShellConfig =>
  isLegacyWslBashPath(shell)
    ? { shell, args: ["-s"], commandTransport: "stdin" }
    : { shell, args: ["-c"] };

const missingWindowsBash = (candidates: readonly string[]): ExecutionError =>
  new ExecutionError(
    "shell_unavailable",
    `No bash shell found. Options:\n` +
      `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
      `  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
      "  3. Configure an explicit shellPath\n\n" +
      `Searched Git Bash in:\n${candidates.map((path) => `  ${path}`).join("\n")}`,
  );

const windowsShellConfig = Effect.fnUntraced(function* () {
  const candidates: string[] = [];
  const programFiles = environmentVariable("ProgramFiles", false);
  if (programFiles !== undefined) candidates.push(`${programFiles}\\Git\\bin\\bash.exe`);
  const programFilesX86 = environmentVariable("ProgramFiles(x86)", false);
  if (programFilesX86 !== undefined) candidates.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
  for (const candidate of candidates) {
    if (yield* pathExists(candidate))
      return ok<ShellConfig, ExecutionError>(bashShellConfig(candidate));
  }
  const bashOnPath = yield* findBashOnPath();
  if (bashOnPath !== undefined) return ok<ShellConfig, ExecutionError>(bashShellConfig(bashOnPath));
  return err<ShellConfig, ExecutionError>(missingWindowsBash(candidates));
});

const shellConfigOf = Effect.fnUntraced(function* (customShellPath: string | undefined) {
  if (customShellPath !== undefined && customShellPath !== "") {
    if (yield* pathExists(customShellPath)) {
      return ok<ShellConfig, ExecutionError>(bashShellConfig(customShellPath));
    }
    return err<ShellConfig, ExecutionError>(
      new ExecutionError("shell_unavailable", `Custom shell path not found: ${customShellPath}`),
    );
  }
  if (process.platform === "win32") return yield* windowsShellConfig();
  if (yield* pathExists("/bin/bash"))
    return ok<ShellConfig, ExecutionError>(bashShellConfig("/bin/bash"));
  const bashOnPath = yield* findBashOnPath();
  if (bashOnPath !== undefined) return ok<ShellConfig, ExecutionError>(bashShellConfig(bashOnPath));
  return ok<ShellConfig, ExecutionError>({ shell: "sh", args: ["-c"] });
});

export const shellConfig = (
  customShellPath: string | undefined,
): Promise<Result<ShellConfig, ExecutionError>> =>
  nodeRuntime.runPromise(shellConfigOf(customShellPath));
