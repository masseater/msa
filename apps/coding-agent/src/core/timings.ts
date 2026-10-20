import platform from "./platform.ts";
import processEnv from "./process-env.ts";

const { readEnv } = processEnv;
const { nowMs, writeError } = platform;

const ENABLED = readEnv("MSA_TIMING") === "1";
interface TimingNamespace {
  timings: Array<{ label: string; ms: number }>;
  lastTime: number;
}

type TimingLabel = "main" | "extensions";

const timingNamespaces = new Map<TimingLabel, TimingNamespace>();

function resetTimings(namespace: TimingLabel = "main"): void {
  if (!ENABLED) return;
  timingNamespaces.set(namespace, { lastTime: nowMs(), timings: [] });
}

function time(label: string, namespace: TimingLabel = "main"): void {
  if (!ENABLED) return;
  const now = nowMs();

  if (!timingNamespaces.has(namespace)) {
    resetTimings(namespace);
  }

  const timingNamespace = timingNamespaces.get(namespace)!;
  timingNamespace.timings.push({ label, ms: now - timingNamespace.lastTime });
  timingNamespace.lastTime = now;
}

function printTimingGroup(title: string, timings: TimingNamespace["timings"]): void {
  const printableTimings = timings.filter((timing) => timing.ms >= 0);
  if (printableTimings.length === 0) return;
  writeError(`\n--- ${title} ---`);
  for (const t of printableTimings) {
    writeError(`  ${t.label}: ${t.ms}ms`);
  }
  writeError(`  TOTAL: ${printableTimings.reduce((a, b) => a + b.ms, 0)}ms`);
  writeError(`${"-".repeat(title.length + 8)}\n`);
}

function printTimings(): void {
  if (!ENABLED) return;
  for (const [namespace, timingNamespace] of timingNamespaces) {
    printTimingGroup(`Startup Timings: ${namespace}`, timingNamespace.timings);
  }
}

const timings = {
  printTimings,
  resetTimings,
  time,
};

export default timings;
