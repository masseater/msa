import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
const tsconfig = join(repoRoot, "tsconfig.json");
const baselinePath = join(repoRoot, "tools", "fence-counts.baseline.json");
const workDir = join(repoRoot, ".artifacts", "fence-counts");
const diagnosticsCount = /error TS\d+/gu;
const maxBuffer = 64 * 1024 * 1024;

const FLAGS = [
  ["exactOptionalPropertyTypes", undefined],
  ["noUncheckedIndexedAccess", undefined],
  ["noImplicitOverride", undefined],
  ["noImplicitReturns", undefined],
  ["noPropertyAccessFromIndexSignature", undefined],
  ["noFallthroughCasesInSwitch", undefined],
  ["noUnusedLocals", undefined],
  ["noUnusedParameters", undefined],
  ["noUncheckedSideEffectImports", undefined],
  ["allowUnreachableCode", false],
  ["allowUnusedLabels", false],
];

function measureFlag(flag, value) {
  const configPath = join(workDir, `${flag}.json`);
  const enabled = value === undefined ? true : value;
  writeFileSync(
    configPath,
    `${JSON.stringify({ extends: relative(workDir, tsconfig), compilerOptions: { [flag]: enabled } }, null, 2)}\n`,
  );
  const run = spawnSync(
    process.execPath,
    [tsc, "--noEmit", "--pretty", "false", "-p", configPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer,
    },
  );
  if (run.error !== undefined) {
    throw new Error(`could not run tsc for ${flag}: ${run.error.message}`);
  }
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const diagnostics = (output.match(diagnosticsCount) ?? []).length;
  if (run.status !== 0 && diagnostics === 0) {
    throw new Error(
      `tsc exited ${run.status} without diagnostics for ${flag} (stdout ${run.stdout?.length ?? -1} bytes, stderr ${run.stderr?.length ?? -1} bytes):\n${output.slice(0, 2000)}`,
    );
  }
  return diagnostics;
}

function measureFlags() {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const counts = {};
  for (const [flag, value] of FLAGS) {
    counts[flag] = measureFlag(flag, value);
    process.stderr.write(`measured ${flag}: ${counts[flag]}\n`);
  }
  return counts;
}

function measureEngineLint() {
  const run = spawnSync(
    "vp",
    ["lint", "-c", "vite.config.engine.ts", "--format", "json", "packages", "scripts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer,
    },
  );
  if (run.error !== undefined) {
    throw new Error(`could not run vp lint: ${run.error.message}`);
  }
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const start = output.indexOf("{");
  if (start === -1) {
    throw new Error(`vp lint produced no report (exit ${run.status}):\n${output.slice(0, 2000)}`);
  }
  const report = JSON.parse(output.slice(start));
  const diagnostics = report.diagnostics ?? [];
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  process.stderr.write(`measured engine lint: ${errors}\n`);
  return errors;
}

function gitShortHead() {
  const run = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (run.status === 0) {
    return run.stdout.trim();
  }
  return "unknown";
}

function formatDelta(delta) {
  if (delta === 0) {
    return "";
  }
  if (delta > 0) {
    return `+${delta}`;
  }
  return `${delta}`;
}

function row(label, now, before) {
  const delta = now - before;
  return `${label.padEnd(34)} ${String(now).padStart(6)}  baseline ${String(before).padStart(6)}  ${formatDelta(delta)}`;
}

if (!existsSync(join(repoRoot, "node_modules", "typescript"))) {
  process.stderr.write("typescript is not installed; run the install step first\n");
  process.exit(2);
}

const counts = measureFlags();
const engineLintErrors = measureEngineLint();

if (process.argv.includes("--write")) {
  const baseline = {
    commit: gitShortHead(),
    measuredAt: new Date().toISOString(),
    flags: counts,
    engineLintErrors,
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stderr.write(`wrote ${relative(repoRoot, baselinePath)}\n`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  process.stderr.write(
    `no baseline at ${relative(repoRoot, baselinePath)}; run with --write first\n`,
  );
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const rows = [];
let regressions = 0;

for (const [flag] of FLAGS) {
  const before = baseline.flags[flag];
  const now = counts[flag];
  if (now - before > 0) {
    regressions += 1;
  }
  rows.push(row(flag, now, before));
}

const lintBefore = baseline.engineLintErrors;
if (engineLintErrors - lintBefore > 0) {
  regressions += 1;
}
rows.push(row("engine lint (oxlint)", engineLintErrors, lintBefore));

process.stdout.write(`${rows.join("\n")}\n`);

if (regressions > 0) {
  process.stderr.write(
    `\n${regressions} measurement(s) regressed against ${relative(repoRoot, baselinePath)}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `\nno regression against ${relative(repoRoot, baselinePath)} (measured at ${baseline.commit})\n`,
);
