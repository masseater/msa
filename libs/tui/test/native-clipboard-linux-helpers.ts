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
import { promisify } from "node:util";

export const exec = promisify(execFile);

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

export async function startServer(
  t: TestContext,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ child: ChildProcessWithoutNullStreams; ready: string }> {
  const child = spawn(command, args, { env, stdio: "pipe" });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  });
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  const ready = await new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`${command} exited with ${code}: ${stderr}`)));
    child.stdout.once("data", (data: Buffer) => resolve(data.toString().trim()));
  });
  return { child, ready };
}

export async function readClipboard(method: string, env: NodeJS.ProcessEnv): Promise<ReaderResult> {
  const { stdout } = await exec(
    process.execPath,
    [
      join(fixtures, "clipboard-reader.cjs"),
      join(native, "prebuilds", `linux-${process.arch}`, "linux-platform-x11.node"),
      method,
    ],
    { env, timeout: 6000 },
  );
  return JSON.parse(stdout) as ReaderResult;
}

export async function startX11(t: TestContext) {
  const { child, ready } = await startServer(
    t,
    "Xvfb",
    ["-displayfd", "1", "-screen", "0", "640x480x24", "-nolisten", "tcp"],
    process.env,
  );
  return { child, env: { ...process.env, DISPLAY: `:${ready}` } };
}
