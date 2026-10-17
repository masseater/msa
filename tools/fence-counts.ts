import { NodeRuntime, NodeServices } from "@effect/platform-node";
import getExePath from "@effect/tsgo/lib/getExePath";
import { Console, Data, DateTime, Effect, FileSystem, Layer, Path, Schema } from "effect";

import { captureProcess, processRunnerLayer } from "./capture-process.ts";

const FLAGS: ReadonlyArray<Readonly<{ flag: string; enabled: boolean }>> = [
  { flag: "exactOptionalPropertyTypes", enabled: true },
  { flag: "noUncheckedIndexedAccess", enabled: true },
  { flag: "noImplicitOverride", enabled: true },
  { flag: "noImplicitReturns", enabled: true },
  { flag: "noPropertyAccessFromIndexSignature", enabled: true },
  { flag: "noFallthroughCasesInSwitch", enabled: true },
  { flag: "noUnusedLocals", enabled: true },
  { flag: "noUnusedParameters", enabled: true },
  { flag: "noUncheckedSideEffectImports", enabled: true },
  { flag: "allowUnreachableCode", enabled: false },
  { flag: "allowUnusedLabels", enabled: false },
];

const diagnosticsCount = /error TS\d+/gu;

const FlagConfig = Schema.Struct({
  extends: Schema.String,
  compilerOptions: Schema.Record(Schema.String, Schema.Boolean),
  exclude: Schema.Array(Schema.String),
});
const flagConfigJson = Schema.fromJsonString(FlagConfig, { space: 2 });

const Baseline = Schema.Struct({
  commit: Schema.String,
  measuredAt: Schema.String,
  flags: Schema.Record(Schema.String, Schema.Finite),
});
const baselineJson = Schema.fromJsonString(Baseline, { space: 2 });

class FenceError extends Data.TaggedError("FenceError")<{ readonly message: string }> {}

const formatDelta = (delta: number): string => {
  if (delta === 0) {
    return "";
  }
  return delta > 0 ? `+${delta}` : `${delta}`;
};

const row = (label: string, now: number, before: number): string =>
  `${label.padEnd(34)} ${String(now).padStart(6)}  baseline ${String(before).padStart(6)}  ${formatDelta(now - before)}`;

const flagRows = (counts: Record<string, number>, before: Record<string, number>): string[] =>
  FLAGS.map(({ flag }) => row(flag, counts[flag] ?? 0, before[flag] ?? 0));

const countRegressions = (counts: Record<string, number>, before: Record<string, number>): number =>
  FLAGS.filter(({ flag }) => (counts[flag] ?? 0) - (before[flag] ?? 0) > 0).length;

const makeContext = Effect.gen(function* () {
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
  const fs = yield* FileSystem.FileSystem;
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
  const path = yield* Path.Path;
  const repoRoot = path.resolve(import.meta.dirname, "..");
  return {
    fs,
    path,
    repoRoot,
    tsconfig: path.join(repoRoot, "tsconfig.json"),
    baselinePath: path.join(repoRoot, "tools", "fence-counts.baseline.json"),
    workDir: path.join(repoRoot, ".artifacts", "fence-counts"),
    tsgo: yield* Effect.sync(() => getExePath()),
  };
});

type FenceContext = Effect.Success<typeof makeContext>;

const writeFlagConfig = (context: FenceContext, flag: string, enabled: boolean) =>
  Effect.gen(function* () {
    const configPath = context.path.join(context.workDir, `${flag}.json`);
    const content = yield* Schema.encodeEffect(flagConfigJson)({
      extends: context.path.relative(context.workDir, context.tsconfig),
      compilerOptions: { [flag]: enabled },
      exclude: [
        "../../*.ts",
        "../../tools/**",
        "../../**/dist/**",
        "../../apps/coding-agent/examples/extensions/gondolin/**",
      ],
    });
    yield* context.fs.writeFileString(configPath, `${content}\n`);
    return configPath;
  });

const measureFlag = (context: FenceContext, flag: string, enabled: boolean) =>
  Effect.gen(function* () {
    const configPath = yield* writeFlagConfig(context, flag, enabled);
    const { stdout, stderr, exitCode } = yield* captureProcess({
      args: ["--noEmit", "--pretty", "false", "-p", configPath],
      command: context.tsgo,
      cwd: context.repoRoot,
    });
    const output = `${stdout}${stderr}`;
    const diagnostics = (output.match(diagnosticsCount) ?? []).length;
    if (exitCode !== 0 && diagnostics === 0) {
      return yield* new FenceError({
        message: `tsgo exited ${exitCode} without diagnostics for ${flag} (stdout ${stdout.length} bytes, stderr ${stderr.length} bytes):\n${output.slice(0, 2000)}`,
      });
    }
    yield* Console.error(`measured ${flag}: ${diagnostics}`);
    return diagnostics;
  });

const gitShortHead = (context: FenceContext) =>
  Effect.gen(function* () {
    const { stdout, exitCode } = yield* captureProcess({
      args: ["rev-parse", "--short", "HEAD"],
      command: "git",
      cwd: context.repoRoot,
    });
    return exitCode === 0 ? stdout.trim() : "unknown";
  });

const writeBaseline = (context: FenceContext, counts: Record<string, number>) =>
  Effect.gen(function* () {
    const content = yield* Schema.encodeEffect(baselineJson)({
      commit: yield* gitShortHead(context),
      measuredAt: DateTime.formatIso(yield* DateTime.now),
      flags: counts,
    });
    yield* context.fs.writeFileString(context.baselinePath, `${content}\n`);
    yield* Console.error(`wrote ${context.path.relative(context.repoRoot, context.baselinePath)}`);
  });

const compareWithBaseline = (context: FenceContext, counts: Record<string, number>) =>
  Effect.gen(function* () {
    const relativeBaseline = context.path.relative(context.repoRoot, context.baselinePath);
    const baselineExists = yield* context.fs.exists(context.baselinePath);
    if (!baselineExists) {
      return yield* new FenceError({
        message: `no baseline at ${relativeBaseline}; run with --write first`,
      });
    }
    const baseline = yield* Schema.decodeEffect(baselineJson)(
      yield* context.fs.readFileString(context.baselinePath),
    );
    const rows = flagRows(counts, baseline.flags);
    yield* Console.log(rows.join("\n"));
    const regressions = countRegressions(counts, baseline.flags);
    if (regressions > 0) {
      return yield* new FenceError({
        message: `${regressions} measurement(s) regressed against ${relativeBaseline}`,
      });
    }
    yield* Console.log(
      `\nno regression against ${relativeBaseline} (measured at ${baseline.commit})`,
    );
  });

const program = Effect.gen(function* () {
  const context = yield* makeContext;
  yield* context.fs.remove(context.workDir, { recursive: true, force: true });
  yield* context.fs.makeDirectory(context.workDir, { recursive: true });
  const counts: Record<string, number> = {};
  for (const { flag, enabled } of FLAGS) {
    counts[flag] = yield* measureFlag(context, flag, enabled);
  }
  if (process.argv.includes("--write")) {
    yield* writeBaseline(context, counts);
    return;
  }
  yield* compareWithBaseline(context, counts);
});

// oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
const mainLayer = Layer.mergeAll(NodeServices.layer, processRunnerLayer);

// oxlint-disable-next-line effecttsgo/unstable-api-usage, effecttsgo/strict-effect-provide -- application entry point on pre-GA v4 platform APIs
NodeRuntime.runMain(program.pipe(Effect.provide(mainLayer)));
