import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";

import command from "./command.ts";
import report from "./report.ts";
import type reportTypes from "./report.types.ts";

const {
  CONFORMANCE_PACKAGE,
  IGNORED_STATUSES,
  MODES,
  evaluate,
  loadBaselineJson,
  log,
  logError,
  makeTempDir,
  pathExists,
  printResults,
  readJson,
  record,
  removeDir,
  scopeBaseline,
  toBaseline,
  usage,
  writeJson,
} = report;

const { conformanceEnv, findFile, prepareLauncher, runCommand } = command;

const SCENARIO_TIMEOUT_MS = 30_000;

const baselinePath = fileURLToPath(new URL("baseline.json", import.meta.url));

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

const runScenarioPart1 = (input: {
  readonly launcher: string;
  readonly mode: string;
  readonly scenario: string;
  readonly workDir: string;
}) =>
  Effect.gen(function* () {
    const { workDir, mode, scenario, launcher } = input;
    const path = yield* Path.Path;
    const scenarioDir = path.join(workDir, mode, scenario.replace(/[^A-Za-z0-9_.-]+/gu, "-"));
    yield* Effect.orDie(
      Effect.flatMap(FileSystem.FileSystem, (fs) =>
        fs.makeDirectory(scenarioDir, { recursive: true }),
      ),
    );
    const reportPath = path.join(scenarioDir, "msa-client.json");
    const result: reportTypes.ScenarioResult = {
      checks: new Map(),
      messages: new Map(),
      mode,
      scenario,
    };
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
    return { reportPath, result, run, scenarioDir };
  });

const runScenario = (
  mode: string,
  scenario: string,
  launcher: string,
  workDir: string,
  verbose: boolean,
) =>
  Effect.gen(function* () {
    const { reportPath, result, run, scenarioDir } = yield* runScenarioPart1({
      launcher,
      mode,
      scenario,
      workDir,
    });
    if (verbose) process.stderr.write(run.stderr);

    const checksPath = yield* findFile(scenarioDir, "checks.json");
    if (checksPath === undefined || checksPath === "") {
      record({
        id: "runner",
        message: `No checks.json (runner exit ${run.code}): ${run.stderr.trim().slice(-2000)}`,
        result,
        status: "fail",
      });
      return result;
    }
    const checks = (yield* readJson(checksPath)) as ReadonlyArray<reportTypes.RawCheck>;
    for (const check of checks) {
      const status = String(check.status ?? "FAILURE").toUpperCase();
      if (IGNORED_STATUSES.has(status)) continue;
      const id = String(check.id ?? check.name ?? "unnamed");
      const message = String(check.errorMessage ?? check.description ?? "");
      record({ id, message, result, status: status === "SUCCESS" ? "pass" : "fail" });
    }

    let client: { success?: unknown; error?: unknown } = { error: "client.ts wrote no report" };
    if (yield* pathExists(reportPath)) client = (yield* readJson(reportPath)) as typeof client;
    record({
      id: "msa-client",
      message: String(client.error ?? ""),
      result,
      status: client.success === true ? "pass" : "fail",
    });
    return result;
  });

const loadBaseline = (): Effect.Effect<reportTypes.Baseline | undefined> =>
  loadBaselineJson(baselinePath);

const parseOptions = () =>
  parseArgs({
    options: {
      help: { default: false, short: "h", type: "boolean" },
      "keep-results": { default: false, type: "boolean" },
      mode: { multiple: true, type: "string" },
      scenario: { multiple: true, type: "string" },
      "update-baseline": { default: false, type: "boolean" },
      verbose: { default: false, type: "boolean" },
    },
  }).values;

type Options = ReturnType<typeof parseOptions>;

const optionError = (values: Options, modes: readonly string[]): string | undefined => {
  if (process.platform === "win32") return "The conformance runner needs a POSIX shell.";
  const unsupported = modes.find((mode) => !(MODES as ReadonlyArray<string>).includes(mode));
  if (unsupported !== undefined)
    return `Unsupported mode ${unsupported}. Supported: ${MODES.join(", ")}`;
  const partial = values.mode !== undefined || values.scenario !== undefined;
  if (values["update-baseline"] === true && partial)
    return "--update-baseline needs a full run, without --mode or --scenario.";
  return undefined;
};

const runScenarios = Effect.fn("runScenarios")(function* (
  values: Options,
  modes: readonly string[],
  workDir: string,
) {
  const launcher = yield* prepareLauncher(workDir);
  const results: reportTypes.ScenarioResult[] = [];
  for (const mode of modes) {
    const scenarios = (yield* listScenarios(mode, workDir)).filter(
      (scenario) => values.scenario === undefined || values.scenario.includes(scenario),
    );
    for (const scenario of scenarios) {
      process.stderr.write(`${mode} ${scenario}\n`);
      results.push(yield* runScenario(mode, scenario, launcher, workDir, values.verbose === true));
    }
  }
  return results;
});

const compareWithBaseline = Effect.fn("compareWithBaseline")(function* (
  values: Options,
  modes: readonly string[],
  results: reportTypes.ScenarioResult[],
) {
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
  const partial = values.mode !== undefined || values.scenario !== undefined;
  const scoped = scopeBaseline({ baseline, modes, partial, scenarios: values.scenario });
  return evaluate({ baseline: scoped, results }) ? 0 : 1;
});

const main = () =>
  Effect.gen(function* () {
    const values = parseOptions();
    if (values.help === true) {
      log(usage());
      return 0;
    }
    const modes = values.mode ?? [...MODES];
    const error = optionError(values, modes);
    if (error !== undefined) {
      logError(error);
      return 1;
    }
    const workDir = yield* makeTempDir("msa-mcp-conformance-");
    const results = yield* runScenarios(values, modes, workDir);
    if (values["keep-results"] === true) log(`\nResults kept in ${workDir}`);
    else yield* removeDir(workDir);
    if (results.length === 0) {
      logError("No scenarios matched.");
      return 1;
    }
    printResults(results);
    if (values["update-baseline"] !== true)
      return yield* compareWithBaseline(values, modes, results);
    yield* writeJson({ path: baselinePath, value: toBaseline(results) });
    log(`\nWrote ${baselinePath}`);
    return 0;
  });

const runtime = ManagedRuntime.make(NodeServices.layer);

void runtime.runPromise(main()).then((code) => process.exit(code));
