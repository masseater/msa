import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import childProcess from "../utils/child-process.ts";
import shell from "../utils/shell.ts";
import awaitingModule from "./awaiting.ts";
import processEnv from "./process-env.ts";
import type tregTypes from "./treg.types.ts";

const { awaited, awaiting } = awaitingModule;
const { spawnProcess, spawnProcessSync, waitForChildProcess } = childProcess;
const { findExecutableOnPath } = shell;
const { envSnapshot } = processEnv;

const PREFERRED_VENDOR = "tinyfish";
const MAX_COST_USD = "0.05";

const CliEnvelope = Schema.fromJsonString(
  Schema.Struct({
    _treg: Schema.Struct({
      charged_micro: Schema.optionalKey(Schema.Finite),
      http_status: Schema.Finite,
    }),
    result: Schema.Unknown,
  }),
);

const RoutedResult = Schema.Struct({
  _treg: Schema.optionalKey(
    Schema.Struct({ served_by: Schema.String.pipe(Schema.NullOr, Schema.optionalKey) }),
  ),
  output: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.NullOr, Schema.optionalKey),
});

function spawnRunner(command: string): tregTypes.TregRunner {
  return (args, signal) =>
    Effect.runPromise(
      awaiting(function* () {
        const child = spawnProcess(command, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          ...(signal === undefined ? {} : { signal }),
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
        child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
        const exitCode = yield* awaited(waitForChildProcess(child));
        signal?.throwIfAborted();
        return { exitCode, stderr, stdout };
      }),
    );
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

const TREG_INSTALL_COMMAND = "curl -fsSL https://treg.to/install.sh | sh";

function findTregCli(
  find: (executable: string) => string | null = findExecutableOnPath,
  env: NodeJS.ProcessEnv = envSnapshot(),
): { command: string; signedIn: boolean } | undefined {
  const command = find("treg");
  return command !== null && command !== ""
    ? { command, signedIn: isSignedIn(command, env) }
    : undefined;
}

function findTreg(
  find: (executable: string) => string | null = findExecutableOnPath,
  env: NodeJS.ProcessEnv = envSnapshot(),
): tregTypes.TregOptions | undefined {
  const cli = findTregCli(find, env);
  return cli?.signedIn === true ? { run: spawnRunner(cli.command) } : undefined;
}

function loginTreg(
  command: string,
  onPage: (page: tregTypes.TregSignInPage) => void,
  signal?: AbortSignal,
): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const child = spawnProcess(command, ["login"], {
        env: { ...envSnapshot(), PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
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
        onPage(code !== undefined && code !== "" ? { code, url } : { url });
      };
      child.stdout?.setEncoding("utf8").on("data", onOutput);
      child.stderr?.setEncoding("utf8").on("data", onOutput);
      const exitCode = yield* awaited(
        waitForChildProcess(child).catch((error: unknown) => {
          signal?.throwIfAborted();
          throw error;
        }),
      );
      signal?.throwIfAborted();
      if (exitCode !== 0) {
        const lines = output
          .trim()
          .split("\n")
          .filter((line) => line.trim() && !line.includes("https://"));
        throw new Error(`treg login failed: ${lines.at(-1)?.trim() || `exit ${exitCode}`}`);
      }
    }),
  );
}

function logoutTreg(command: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const child = spawnProcess(command, ["logout"], {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      const exitCode = yield* awaited(waitForChildProcess(child));
      if (exitCode !== 0) {
        throw new Error(`treg logout failed: ${stderr.trim() || `exit ${exitCode}`}`);
      }
    }),
  );
}

function describeFailure(status: number, body: unknown): string {
  const detail = typeof body === "object" && body !== null && "detail" in body ? body.detail : body;
  const message = `treg returned ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  return status === 401 ? `${message}. Sign in with \`treg login\` or set TREG_TOKEN.` : message;
}

const tregCallArgs = (job: string, body: Readonly<Record<string, unknown>>) => [
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
];

function parseTregOutput(stdout: string, stderr: string, exitCode: unknown): tregTypes.TregResult {
  const line = stdout.trim().split("\n").at(-1) ?? "";
  const envelope = Schema.decodeOption(CliEnvelope)(line);
  if (Option.isNone(envelope)) {
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
  const { output, _treg: routedMeta } = decoded.value;
  const tregResult: tregTypes.TregResult = { output: output ?? {} };
  const servedBy = routedMeta?.served_by;
  if (servedBy !== undefined && servedBy !== null && servedBy !== "") {
    tregResult.servedBy = servedBy;
  }
  if (meta.charged_micro !== undefined) tregResult.costMicro = meta.charged_micro;
  return tregResult;
}

function callTreg(
  options: tregTypes.TregOptions,
  job: string,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<tregTypes.TregResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const { stdout, stderr, exitCode } = yield* awaited(
        options.run(tregCallArgs(job, body), signal),
      );
      return parseTregOutput(stdout, stderr, exitCode);
    }),
  );
}

function pickString(row: unknown, ...keys: string[]): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function rows(output: Readonly<Record<string, unknown>>, key: string): unknown[] {
  const value = output[key];
  return Array.isArray(value) ? value : [];
}

const treg = {
  TREG_INSTALL_COMMAND,
  callTreg,
  findTreg,
  findTregCli,
  loginTreg,
  logoutTreg,
  pickString,
  rows,
};

export default treg;
