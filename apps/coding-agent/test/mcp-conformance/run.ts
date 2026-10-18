import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Path, Stream } from "effect";
import { ChildProcess } from "effect/process";

import { envSnapshot } from "../../src/core/process-env.ts";
import {
  CONFORMANCE_PACKAGE,
  type Baseline,
  type RawCheck,
  type ScenarioResult,
  evaluate,
  IGNORED_STATUSES,
  loadBaselineJson,
  log,
  makeTempDir,
  pathExists,
  readJson,
  removeDir,
  writeJson,
  logError,
  MODES,
  printResults,
  record,
  scopeBaseline,
  toBaseline,
  usage,
} from "./report.ts";

const SCENARIO_TIMEOUT_MS = 30_000;

const baselinePath = fileURLToPath(new URL("baseline.json", import.meta.url));
const clientPath = fileURLToPath(new URL("client.ts", import.meta.url));
const resolverUrl = pathToFileURL(
  fileURLToPath(new URL("../../src/experimental/source-resolver.ts", import.meta.url)),
).href;

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const runCommand = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
) => {
  const run = Effect.gen(function* () {
    const handle = yield* ChildProcess.make(command, args, {
      cwd: options.cwd,
      ...(options.env === undefined ? {} : { env: options.env }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = yield* Effect.all(
      [
        handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
        handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
        handle.exitCode,
      ],
      { concurrency: 3 },
    );
    return { code: code ?? 1, stdout, stderr } satisfies CommandResult;
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed((): CommandResult => ({ code: 1, stdout: "", stderr: "" })),
  );
  if (options.timeoutMs === undefined) return run;
  return run.pipe(
    Effect.timeout(options.timeoutMs),
    Effect.orElseSucceed((): CommandResult => ({ code: 1, stdout: "", stderr: "timed out" })),
  );
};

const conformanceEnv = (): Record<string, string> => ({
  ...envSnapshot(),
  npm_config_ignore_scripts: "true",
  npm_config_yes: "true",
});

const listScenarios = (mode: string, workDir: string) =>
  Effect.gen(function* () {
    const result = yield* runCommand(
      "npx",
      ["--yes", CONFORMANCE_PACKAGE, "list", "--client", "--spec-version", mode],
      { cwd: workDir, env: conformanceEnv() },
    );
    if (result.code !== 0)
      throw new Error(`Listing ${mode} scenarios failed:\n${result.stderr || result.stdout}`);
    return [...result.stdout.matchAll(/^\s+- (\S+)/gmu)].flatMap((match) => match[1] ?? []);
  });

const findFile = (
  dir: string,
  name: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fs.exists(dir).pipe(Effect.orDie))) return undefined;
    for (const entry of yield* fs.readDirectory(dir).pipe(Effect.orDie)) {
      const entryPath = path.join(dir, entry);
      const info = yield* fs.stat(entryPath).pipe(Effect.orElseSucceed(() => undefined));
      if (info === undefined) continue;
      if (info.type === "File" && entry === name) return entryPath;
      if (info.type === "Directory") {
        const found = yield* findFile(entryPath, name);
        if (found !== undefined && found !== "") return found;
      }
    }
    return undefined;
  });

const runScenario = (
  mode: string,
  scenario: string,
  launcher: string,
  workDir: string,
  verbose: boolean,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const scenarioDir = path.join(workDir, mode, scenario.replace(/[^A-Za-z0-9_.-]+/gu, "-"));
    yield* Effect.orDie(
      Effect.flatMap(FileSystem.FileSystem, (fs) =>
        fs.makeDirectory(scenarioDir, { recursive: true }),
      ),
    );
    const reportPath = path.join(scenarioDir, "msa-client.json");
    const result: ScenarioResult = { mode, scenario, checks: new Map(), messages: new Map() };
    const run = yield* runCommand(
      "npx",
      [
        "--yes",
        CONFORMANCE_PACKAGE,
        "client",
        "--command",
        launcher,
        "--scenario",
        scenario,
        "--spec-version",
        mode,
        "--timeout",
        String(SCENARIO_TIMEOUT_MS),
        "--output-dir",
        scenarioDir,
      ],
      {
        cwd: workDir,
        env: { ...conformanceEnv(), MSA_MCP_CONFORMANCE_REPORT: reportPath },
        timeoutMs: SCENARIO_TIMEOUT_MS + 30_000,
      },
    );
    if (verbose) process.stderr.write(run.stderr);

    const checksPath = yield* findFile(scenarioDir, "checks.json");
    if (checksPath === undefined || checksPath === "") {
      record({
        result,
        id: "runner",
        status: "fail",
        message: `No checks.json (runner exit ${run.code}): ${run.stderr.trim().slice(-2000)}`,
      });
      return result;
    }
    const checks = (yield* readJson(checksPath)) as ReadonlyArray<RawCheck>;
    for (const check of checks) {
      const status = String(check.status ?? "FAILURE").toUpperCase();
      if (IGNORED_STATUSES.has(status)) continue;
      const id = String(check.id ?? check.name ?? "unnamed");
      const message = String(check.errorMessage ?? check.description ?? "");
      record({ result, id, status: status === "SUCCESS" ? "pass" : "fail", message });
    }

    let client: { success?: unknown; error?: unknown } = { error: "client.ts wrote no report" };
    if (yield* pathExists(reportPath)) client = (yield* readJson(reportPath)) as typeof client;
    record({
      result,
      id: "msa-client",
      status: client.success === true ? "pass" : "fail",
      message: String(client.error ?? ""),
    });
    return result;
  });

const loadBaseline = (): Effect.Effect<Baseline | undefined> => loadBaselineJson(baselinePath);

const prepareLauncher = (
  workDir: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const launcher = path.join(workDir, "msa-client");
    yield* fs
      .writeFileString(
        launcher,
        `#!/bin/sh\nexec ${shellQuote(process.execPath)} --import ${shellQuote(resolverUrl)} ${shellQuote(clientPath)} "$@"\n`,
      )
      .pipe(Effect.orDie);
    yield* fs.chmod(launcher, 0o755).pipe(Effect.orDie);
    return launcher;
  });

const main = () =>
  Effect.gen(function* () {
    const { values } = parseArgs({
      options: {
        mode: { type: "string", multiple: true },
        scenario: { type: "string", multiple: true },
        "update-baseline": { type: "boolean", default: false },
        "keep-results": { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    if (values.help === true) {
      log(usage());
      return 0;
    }
    if (process.platform === "win32") {
      logError("The conformance runner needs a POSIX shell.");
      return 1;
    }
    const modes = values.mode ?? [...MODES];
    for (const mode of modes) {
      if (!(MODES as ReadonlyArray<string>).includes(mode)) {
        logError(`Unsupported mode ${mode}. Supported: ${MODES.join(", ")}`);
        return 1;
      }
    }
    const partial = values.mode !== undefined || values.scenario !== undefined;
    if (values["update-baseline"] === true && partial) {
      logError("--update-baseline needs a full run, without --mode or --scenario.");
      return 1;
    }

    const workDir = yield* makeTempDir("msa-mcp-conformance-");
    const launcher = yield* prepareLauncher(workDir);
    const results: ScenarioResult[] = [];
    for (const mode of modes) {
      const scenarios = (yield* listScenarios(mode, workDir)).filter(
        (scenario) => values.scenario === undefined || values.scenario.includes(scenario),
      );
      for (const scenario of scenarios) {
        process.stderr.write(`${mode} ${scenario}\n`);
        results.push(
          yield* runScenario(mode, scenario, launcher, workDir, values.verbose === true),
        );
      }
    }
    if (values["keep-results"] === true) log(`\nResults kept in ${workDir}`);
    else yield* removeDir(workDir);
    if (results.length === 0) {
      logError("No scenarios matched.");
      return 1;
    }
    printResults(results);

    if (values["update-baseline"] === true) {
      yield* writeJson({ path: baselinePath, value: toBaseline(results) });
      log(`\nWrote ${baselinePath}`);
      return 0;
    }
    const baseline = yield* loadBaseline();
    if (baseline === undefined) {
      logError("\nNo baseline.json. Run with --update-baseline and review it.");
      return 1;
    }
    if (baseline.conformance !== CONFORMANCE_PACKAGE) {
      logError(
        `\nbaseline.json is for ${baseline.conformance}, not ${CONFORMANCE_PACKAGE}. Regenerate it.`,
      );
      return 1;
    }
    return evaluate({
      results,
      baseline: scopeBaseline({
        baseline,
        modes,
        scenarios: values.scenario,
        partial,
      }),
    })
      ? 0
      : 1;
  });

const runtime = ManagedRuntime.make(NodeServices.layer);

void runtime.runPromise(main()).then((code) => process.exit(code));
