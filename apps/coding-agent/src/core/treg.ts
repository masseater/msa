/**
 * Runs treg (https://treg.to) routed jobs through the official `treg` CLI, which tries web vendors
 * in order until one answers. The CLI owns sign-in (`treg login`, or `TREG_TOKEN`), and
 * `treg --json call` prints one `{result, _treg}` line per call.
 */

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { spawnProcess, spawnProcessSync, waitForChildProcess } from "../utils/child-process.ts";
import { findExecutableOnPath } from "../utils/shell.ts";
import { envSnapshot } from "./process-env.ts";

/** TinyFish answers web search and page reads for free; treg falls back to paid vendors after it. */
const PREFERRED_VENDOR = "tinyfish";
/** Caps what one call may spend walking paid vendors after a miss. treg's own default is $1. */
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
  /** Runs the `treg` CLI with these arguments. */
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
      ...(signal ? { signal } : {}),
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

/** Whether the CLI has a login to call with: `TREG_TOKEN`, or what `treg config` reports. */
function isSignedIn(command: string, env: NodeJS.ProcessEnv): boolean {
  if (env["TREG_TOKEN"]?.trim()) return true;
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

/** Where to get the CLI when it is not installed. */
export const TREG_INSTALL_COMMAND = "curl -fsSL https://treg.to/install.sh | sh";

/** The installed `treg` CLI and whether it has a login to call with. */
export function findTregCli(
  find: (executable: string) => string | null = findExecutableOnPath,
  env: NodeJS.ProcessEnv = envSnapshot(),
): { command: string; signedIn: boolean } | undefined {
  const command = find("treg");
  return command ? { command, signedIn: isSignedIn(command, env) } : undefined;
}

/** The installed and signed-in `treg` CLI, or undefined when the web tools are unavailable. */
export function findTreg(
  find: (executable: string) => string | null = findExecutableOnPath,
  env: NodeJS.ProcessEnv = envSnapshot(),
): TregOptions | undefined {
  const cli = findTregCli(find, env);
  return cli?.signedIn ? { run: spawnRunner(cli.command) } : undefined;
}

export interface TregSignInPage {
  url: string;
  /** The code the sign-in page shows, for the user to check it matches. */
  code?: string;
}

/**
 * Run `treg login`, which opens the browser sign-in page itself and waits until the user approves
 * it there. `onPage` receives the page as the CLI prints it, for showing when no browser opens.
 */
export async function loginTreg(
  command: string,
  onPage: (page: TregSignInPage) => void,
  signal?: AbortSignal,
): Promise<void> {
  const child = spawnProcess(command, ["login"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...envSnapshot(), PYTHONUNBUFFERED: "1" },
    ...(signal ? { signal } : {}),
  });
  let output = "";
  let shown = false;
  const onOutput = (chunk: string) => {
    output = (output + chunk).slice(-4_000);
    const url = /https:\/\/\S+/.exec(output)?.[0];
    if (shown || !url) return;
    const code = /matches:\s*(\S+)/.exec(output)?.[1];
    if (!code && !/Waiting/.test(output)) return;
    shown = true;
    onPage(code ? { url, code } : { url });
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

/** Run `treg logout`, which clears the login `treg login` stored on this machine. */
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

/** Run a treg routed job such as `treg.web.search` and return its normalized `output`. */
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
  if (routed._treg?.served_by) tregResult.servedBy = routed._treg.served_by;
  if (meta.charged_micro !== undefined) tregResult.costMicro = meta.charged_micro;
  return tregResult;
}

/** A string field of a vendor's row, trying the names vendors use for it in order. */
export function pickString(row: unknown, ...keys: string[]): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** The rows of an output field, which treg leaves null on a miss. */
export function rows(output: Readonly<Record<string, unknown>>, key: string): unknown[] {
  const value = output[key];
  return Array.isArray(value) ? value : [];
}
