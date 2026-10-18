import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, FileSystem, ManagedRuntime, Schema } from "effect";

export const CONFORMANCE_PACKAGE = "@modelcontextprotocol/conformance@0.2.0-alpha.11";

export const MODES = ["2025-03-26", "2025-06-18", "2025-11-25"] as const;

export const IGNORED_STATUSES = new Set(["INFO", "SKIPPED"]);

export type CheckStatus = "pass" | "fail";

export interface ScenarioResult {
  mode: string;
  scenario: string;
  checks: Map<string, CheckStatus>;
  messages: Map<string, string>;
}

export interface BaselineScenario {
  passing: string[];
  failing: string[];
}

export interface Baseline {
  conformance: string;
  modes: Record<string, Record<string, BaselineScenario>>;
}

export interface RawCheck {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  description?: unknown;
  errorMessage?: unknown;
}

const runtime = ManagedRuntime.make(NodeServices.layer);

const provideNode = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
  Effect.flatMap(runtime.contextEffect, (context) =>
    Effect.provideContext(effect, context),
  ) as unknown as Effect.Effect<A, E>;

export const log = (message: string): void => {
  Effect.runSync(Console.log(message));
};

export const logError = (message: string): void => {
  Effect.runSync(Console.error(message));
};

export const record = (entry: {
  result: ScenarioResult;
  id: string;
  status: CheckStatus;
  message?: string;
}): void => {
  const { result, id, status, message } = entry;
  if (result.checks.get(id) !== "fail") result.checks.set(id, status);
  if (status === "fail" && message !== undefined && message !== "" && !result.messages.has(id))
    result.messages.set(id, message);
};

export const toBaseline = (results: ReadonlyArray<ScenarioResult>): Baseline => {
  const baseline: Baseline = { conformance: CONFORMANCE_PACKAGE, modes: {} };
  for (const result of results) {
    const ids = [...result.checks.keys()].sort();
    const scenarios = (baseline.modes[result.mode] ??= {});
    scenarios[result.scenario] = {
      passing: ids.filter((id) => result.checks.get(id) === "pass"),
      failing: ids.filter((id) => result.checks.get(id) === "fail"),
    };
  }
  return baseline;
};

export const evaluate = (entry: {
  results: ReadonlyArray<ScenarioResult>;
  baseline: Baseline;
}): boolean => {
  const { results, baseline } = entry;
  const regressions: string[] = [];
  const fixed: string[] = [];
  for (const result of results) {
    const expected = baseline.modes[result.mode]?.[result.scenario];
    const label = `${result.mode} ${result.scenario}`;
    for (const [id, status] of result.checks) {
      const message = result.messages.get(id);
      if (status === "fail" && expected?.failing.includes(id) !== true) {
        regressions.push(
          `${label}: ${id} fails${message !== undefined && message !== "" ? `: ${message}` : ""}`,
        );
      }
      if (status === "pass" && expected?.failing.includes(id) === true)
        fixed.push(`${label}: ${id}`);
    }
    for (const id of expected?.passing ?? []) {
      if (!result.checks.has(id)) regressions.push(`${label}: ${id} was not reported`);
    }
  }
  for (const [mode, scenarios] of Object.entries(baseline.modes)) {
    for (const scenario of Object.keys(scenarios)) {
      if (!results.some((result) => result.mode === mode && result.scenario === scenario)) {
        regressions.push(`${mode} ${scenario}: scenario did not run`);
      }
    }
  }
  if (fixed.length > 0) {
    log(
      `\nFixed since the baseline (run with --update-baseline):\n${fixed.map((line) => `  ${line}`).join("\n")}`,
    );
  }
  if (regressions.length > 0) {
    log(`\nRegressions:\n${regressions.map((line) => `  ${line}`).join("\n")}`);
    return false;
  }
  log("\nNo regressions against the baseline.");
  return true;
};

export const printResults = (results: ReadonlyArray<ScenarioResult>): void => {
  for (const mode of MODES) {
    const modeResults = results.filter((result) => result.mode === mode);
    if (modeResults.length === 0) continue;
    log(`\n${mode}`);
    for (const result of modeResults) {
      const statuses = [...result.checks.values()];
      const failed = statuses.filter((status) => status === "fail").length;
      const passed = statuses.length - failed;
      log(
        `  ${failed === 0 ? "pass" : "FAIL"} ${result.scenario} (${passed} passed, ${failed} failed)`,
      );
      for (const [id, status] of result.checks) {
        if (status !== "fail") continue;
        const message = result.messages.get(id)?.replace(/\s+/gu, " ").slice(0, 300);
        log(`         ${id}${message !== undefined && message !== "" ? `: ${message}` : ""}`);
      }
    }
  }
};

export const scopeBaseline = (entry: {
  baseline: Baseline;
  modes: ReadonlyArray<string>;
  scenarios: ReadonlyArray<string> | undefined;
  partial: boolean;
}): Baseline => {
  const { baseline, modes, scenarios, partial } = entry;
  if (!partial) return baseline;
  return {
    conformance: baseline.conformance,
    modes: Object.fromEntries(
      modes.map((mode) => [
        mode,
        Object.fromEntries(
          Object.entries(baseline.modes[mode] ?? {}).filter(
            ([scenario]) => scenarios === undefined || scenarios.includes(scenario),
          ),
        ),
      ]),
    ),
  };
};

export const usage =
  (): string => `Usage: node apps/coding-agent/test/mcp-conformance/run.ts [options]

Options:
  --mode <version>     Only run this protocol version (repeatable): ${MODES.join(", ")}
  --scenario <name>    Only run this scenario (repeatable)
  --update-baseline    Write the results to baseline.json instead of comparing
  --keep-results       Keep the upstream checks.json and client output
  --verbose            Print the upstream runner output`;

export const loadBaselineJson = (path: string): Effect.Effect<Baseline | undefined> =>
  Effect.gen(function* () {
    if (!(yield* pathExists(path))) return undefined;
    return (yield* readJson(path)) as Baseline;
  });

const jsonString = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownEffect(jsonString);
const encodeJson = Schema.encodeUnknownEffect(jsonString);

export const readJson = (path: string): Effect.Effect<unknown> =>
  provideNode(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* Effect.orDie(decodeJson(yield* fs.readFileString(path).pipe(Effect.orDie)));
    }),
  );

export const writeJson = (entry: { path: string; value: unknown }): Effect.Effect<void> =>
  provideNode(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs
        .writeFileString(entry.path, `${yield* Effect.orDie(encodeJson(entry.value))}\n`)
        .pipe(Effect.orDie);
    }),
  );

export const pathExists = (path: string): Effect.Effect<boolean> =>
  provideNode(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(path)).pipe(Effect.orDie));

export const makeTempDir = (prefix: string): Effect.Effect<string> =>
  provideNode(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectory({ prefix })).pipe(
      Effect.orDie,
    ),
  );

export const removeDir = (path: string): Effect.Effect<void> =>
  provideNode(
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(path, { recursive: true, force: true }),
    ).pipe(Effect.orDie),
  );
