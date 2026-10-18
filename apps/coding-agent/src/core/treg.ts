import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { spawnProcess, spawnProcessSync, waitForChildProcess } from "../utils/child-process.ts";
import { findExecutableOnPath } from "../utils/shell.ts";

const PREFERRED_VENDOR = "tinyfish";
const MAX_COST_USD = "0.05";

const CliEnvelope = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Unknown,
    _treg: Schema.Struct({
      http_status: Schema.Finite,
      charged_micro: Schema.optionalKey(Schema.Finite),
    }),
  }),
);

const RoutedResult = Schema.Struct({
  output: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.NullOr, Schema.optionalKey),
  _treg: Schema.optionalKey(
    Schema.Struct({ served_by: Schema.String.pipe(Schema.NullOr, Schema.optionalKey) }),
  ),
});

export interface TregRun {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type TregRunner = (args: string[], signal?: AbortSignal) => Promise<TregRun>;

export interface TregOptions {
  run: TregRunner;
}

export interface TregResult {
  output: Readonly<Record<string, unknown>>;
  servedBy?: string;
  costMicro?: number;
}

function spawnRunner(command: string): TregRunner {
  return async (args, signal) => {
    const child = spawnProcess(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(signal === undefined ? {} : { signal }),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const exitCode = await waitForChildProcess(child);
    signal?.throwIfAborted();
    return { stdout, stderr, exitCode };
  };
}

const CliConfig = Schema.fromJsonString(Schema.Struct({ logged_in: Schema.Boolean }));

function isSignedIn(command: string, env: NodeJS.ProcessEnv): boolean {
  if ((env["TREG_TOKEN"]?.trim() ?? "") !== "") return true;
  const { stdout } = spawnProcessSync(command, ["config"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  return Option.match(Schema.decodeOption(CliConfig)(stdout ?? ""), {
    onNone: () => false,
    onSome: (config) => config.logged_in,
  });
}

export const TREG_INSTALL_COMMAND = "curl -fsSL https://treg.to/install.sh | sh";

export function findTregCli(
  find: (executable: string) => string | null = findExecutableOnPath,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; signedIn: boolean } | undefined {
  const command = find("treg");
  return command !== null && command !== ""
    ? { command, signedIn: isSignedIn(command, env) }
    : undefined;
}

export function findTreg(
  find: (executable: string) => string | null = findExecutableOnPath,
  env: NodeJS.ProcessEnv = process.env,
): TregOptions | undefined {
  const cli = findTregCli(find, env);
  return cli?.signedIn === true ? { run: spawnRunner(cli.command) } : undefined;
}

export interface TregSignInPage {
  url: string;
  code?: string;
}

export async function loginTreg(
  command: string,
  onPage: (page: TregSignInPage) => void,
  signal?: AbortSignal,
): Promise<void> {
  const child = spawnProcess(command, ["login"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    ...(signal === undefined ? {} : { signal }),
  });
  let output = "";
  let shown = false;
  const onOutput = (chunk: string) => {
    output = (output + chunk).slice(-4_000);
    const url = /https:\/\/\S+/u.exec(output)?.[0];
    if (shown || url === undefined || url === "") return;
    const code = /matches:\s*(\S+)/u.exec(output)?.[1];
    if ((code === undefined || code === "") && !/Waiting/u.test(output)) return;
    shown = true;
    onPage(code !== undefined && code !== "" ? { url, code } : { url });
  };
  child.stdout?.setEncoding("utf8").on("data", onOutput);
  child.stderr?.setEncoding("utf8").on("data", onOutput);
  const exitCode = await waitForChildProcess(child).catch((error: unknown) => {
    signal?.throwIfAborted();
    throw error;
  });
  signal?.throwIfAborted();
  if (exitCode !== 0) {
    const lines = output
      .trim()
      .split("\n")
      .filter((line) => line.trim() && !line.includes("https://"));
    throw new Error(`treg login failed: ${lines.at(-1)?.trim() || `exit ${exitCode}`}`);
  }
}

export async function logoutTreg(command: string): Promise<void> {
  const child = spawnProcess(command, ["logout"], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const exitCode = await waitForChildProcess(child);
  if (exitCode !== 0) {
    throw new Error(`treg logout failed: ${stderr.trim() || `exit ${exitCode}`}`);
  }
}

function describeFailure(status: number, body: unknown): string {
  const detail = typeof body === "object" && body !== null && "detail" in body ? body.detail : body;
  const message = `treg returned ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  return status === 401 ? `${message}. Sign in with \`treg login\` or set TREG_TOKEN.` : message;
}

export async function callTreg(
  options: TregOptions,
  job: string,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<TregResult> {
  const { stdout, stderr, exitCode } = await options.run(
    [
      "--json",
      "call",
      job,
      "--method",
      "POST",
      "--data",
      JSON.stringify(body),
      "--header",
      `X-Treg-Route-Prefer: ${PREFERRED_VENDOR}`,
      "--header",
      `X-Treg-Route-Max-Cost: ${MAX_COST_USD}`,
    ],
    signal,
  );
  const line = stdout.trim().split("\n").at(-1) ?? "";
  const envelope = Schema.decodeOption(CliEnvelope)(line);
  if (envelope._tag === "None") {
    throw new Error(
      `treg exited ${exitCode} without a result: ${(stderr || stdout).trim().slice(0, 2000)}`,
    );
  }
  const { result, _treg: meta } = envelope.value;
  if (meta.http_status >= 400) throw new Error(describeFailure(meta.http_status, result));
  const decoded = Schema.decodeUnknownOption(RoutedResult)(result);
  if (Option.isNone(decoded)) {
    throw new Error(`treg returned an unexpected result: ${JSON.stringify(result).slice(0, 2000)}`);
  }
  const routed = decoded.value;
  const tregResult: TregResult = { output: routed.output ?? {} };
  if (
    routed._treg?.served_by !== undefined &&
    routed._treg?.served_by !== null &&
    routed._treg?.served_by !== ""
  )
    tregResult.servedBy = routed._treg.served_by;
  if (meta.charged_micro !== undefined) tregResult.costMicro = meta.charged_micro;
  return tregResult;
}

export function pickString(row: unknown, ...keys: string[]): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

export function rows(output: Readonly<Record<string, unknown>>, key: string): unknown[] {
  const value = output[key];
  return Array.isArray(value) ? value : [];
}
