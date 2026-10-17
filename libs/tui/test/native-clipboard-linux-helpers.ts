import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
  spawnSync,
} from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { dual } from "effect/Function";

export interface ExecRequest {
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  timeout: number;
}

export interface ServerRequest {
  t: TestContext;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export const exec = (request: ExecRequest): Effect.Effect<{ stdout: string; stderr: string }> =>
  Effect.callback((resume) => {
    execFile(
      request.file,
      request.args,
      { env: request.env, timeout: request.timeout },
      (error, stdout, stderr) => {
        resume(error === null ? Effect.succeed({ stdout, stderr }) : Effect.die(error));
      },
    );
  });

export const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

export const native = fileURLToPath(new URL("../native/linux/", import.meta.url));

export const supported = process.platform === "linux" && ["arm64", "x64"].includes(process.arch);

export const dependenciesAvailable =
  supported &&
  spawnSync(
    "sh",
    ["-c", "command -v cc && command -v Xvfb && command -v xclip && pkg-config --exists xcb"],
    {
      stdio: "ignore",
    },
  ).status === 0;

export interface ReaderResult {
  ok: boolean;
  value?: string | null;
  unavailable?: boolean;
  length?: number;
  hash?: string;
  error?: string;
}

function killServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  return Effect.runPromise(Effect.asVoid(Effect.promise(() => exited)));
}

export const startServer = ({
  t,
  command,
  args,
  env,
}: ServerRequest): Effect.Effect<{ child: ChildProcessWithoutNullStreams; ready: string }> =>
  Effect.suspend(() => {
    const child = spawn(command, args, { env, stdio: "pipe" });
    t.after(() => killServer(child));
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    return Effect.callback<string>((resume) => {
      child.once("error", (error) => resume(Effect.die(error)));
      child.once("exit", (code) =>
        resume(Effect.die(new Error(`${command} exited with ${code}: ${stderr}`))),
      );
      child.stdout.once("data", (data: Buffer) => resume(Effect.succeed(data.toString().trim())));
    }).pipe(Effect.map((ready) => ({ child, ready })));
  });

export const readClipboard: {
  (method: string, env: NodeJS.ProcessEnv): Effect.Effect<ReaderResult>;
  (env: NodeJS.ProcessEnv): (method: string) => Effect.Effect<ReaderResult>;
} = dual(2, (method: string, env: NodeJS.ProcessEnv): Effect.Effect<ReaderResult> =>
  exec({
    file: process.execPath,
    args: [
      join(fixtures, "clipboard-reader.ts"),
      join(native, "prebuilds", `linux-${process.arch}`, "linux-platform-x11.node"),
      method,
    ],
    env,
    timeout: 6000,
  }).pipe(Effect.map(({ stdout }) => JSON.parse(stdout) as ReaderResult)),
);

export const startX11 = (
  t: TestContext,
): Effect.Effect<{ child: ChildProcessWithoutNullStreams; env: NodeJS.ProcessEnv }> =>
  startServer({
    t,
    command: "Xvfb",
    args: ["-displayfd", "1", "-screen", "0", "640x480x24", "-nolisten", "tcp"],
    env: process.env,
  }).pipe(
    Effect.map(({ child, ready }) => ({ child, env: { ...process.env, DISPLAY: `:${ready}` } })),
  );
