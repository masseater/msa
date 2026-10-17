/**
 * Runs treg (https://treg.to) routed jobs through the official `treg` CLI, which tries web vendors
 * in order until one answers. The CLI owns sign-in (`treg login`, or `TREG_TOKEN`), and
 * `treg --json call` prints one `{result, _treg}` line per call.
 */

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { spawnProcess, spawnProcessSync, waitForChildProcess } from "../utils/child-process.ts";
import { findExecutableOnPath } from "../utils/shell.ts";

/** TinyFish answers web search and page reads for free; treg falls back to paid vendors after it. */
const PREFERRED_VENDOR = "tinyfish";
/** Caps what one call may spend walking paid vendors after a miss. treg's own default is $1. */
const MAX_COST_USD = "0.05";

const CliEnvelope = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Unknown,
    _treg: Schema.Struct({
      http_status: Schema.Number,
      charged_micro: Schema.optionalKey(Schema.Number),
    }),
  }),
);

const RoutedResult = Schema.Struct({
  output: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  _treg: Schema.optionalKey(
    Schema.Struct({ served_by: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
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
  return Option.match(Schema.decodeUnknownOption(CliConfig)(stdout ?? ""), {
    onNone: () => false,
    onSome: (config) => config.logged_in,
  });
}

/** The installed and signed-in `treg` CLI, or undefined when the web tools are unavailable. */
export function findTreg(
  find: (executable: string) => string | null = findExecutableOnPath,
  env: NodeJS.ProcessEnv = process.env,
): TregOptions | undefined {
  const command = find("treg");
  return command && isSignedIn(command, env) ? { run: spawnRunner(command) } : undefined;
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
  const envelope = Schema.decodeUnknownOption(CliEnvelope)(line);
  if (envelope._tag === "None") {
    throw new Error(
      `treg exited ${exitCode} without a result: ${(stderr || stdout).trim().slice(0, 2000)}`,
    );
  }
  const { result, _treg: meta } = envelope.value;
  if (meta.http_status >= 400) throw new Error(describeFailure(meta.http_status, result));
  const routed = Schema.decodeUnknownSync(RoutedResult)(result);
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
