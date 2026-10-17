/**
 * Tool output benchmark: drives the real tool task, adaptive progress throttle, and `msa.live` commits.
 *
 *   node --conditions=source --experimental-strip-types --expose-gc test/tool-output-bench.ts
 *
 * Each scenario runs in its own child process so peak RSS is its own. Rate scenarios write output for a fixed time,
 * then close the Harness mid-round (persistent backends) to measure replay of the round's delta chain on reopen, and
 * finish the run to measure the stored size after the round's base and reclamation. Throughput scenarios push 1 GiB.
 */
import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { BIG_FILE, GIB, LINE, runScenario, type Scenario } from "./tool-output-scenario.ts";

async function main(): Promise<void> {
  const [, , encoded] = process.argv;
  if (encoded !== undefined) {
    const result = await runScenario(JSON.parse(encoded) as Scenario);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const scenarios: Scenario[] = [];
  for (const backend of ["memory", "sqlite", "jsonl"] as const) {
    for (const rate of ["low", "normal", "high"] as const) {
      for (const retain of ["head", "tail"] as const) {
        for (const tools of [1, 4]) scenarios.push({ kind: "rate", backend, rate, retain, tools });
      }
    }
    for (const retain of ["head", "tail"] as const)
      scenarios.push({ kind: "firehose", backend, retain });
    // Identical lines: how often Chord's bounded overlap search falls back to writing the whole tail window.
    scenarios.push({ kind: "firehose", backend, retain: "tail", repetitive: true });
    // One long round: the delta chain a chatty tail tool builds before the round's base.
    if (backend !== "memory")
      scenarios.push({
        kind: "rate",
        backend,
        rate: "high",
        retain: "tail",
        tools: 1,
        seconds: 30,
      });
    scenarios.push({ kind: "cat", backend });
  }
  await ensureBigFile();
  const rows: Record<string, unknown>[] = [];
  for await (const scenario of scenarios) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), JSON.stringify(scenario)],
      { maxBuffer: 1 << 20 },
    );
    rows.push({ ...label(scenario), ...JSON.parse(stdout.trim().split("\n").at(-1)!) });
  }
  console.table(rows);
}

function label(scenario: Scenario): Record<string, unknown> {
  if (scenario.kind === "rate") {
    const { backend, rate, retain, tools, seconds } = scenario;
    return {
      scenario: `${rate} ${retain} x${tools}${seconds === undefined ? "" : ` ${seconds}s`}`,
      backend,
    };
  }
  if (scenario.kind === "cat") return { scenario: "bash cat 1 GiB", backend: scenario.backend };
  const repetitive = scenario.repetitive === true ? " repetitive" : "";
  return {
    scenario: `api.output 1 GiB ${scenario.retain}${repetitive}`,
    backend: scenario.backend,
  };
}

async function ensureBigFile(): Promise<void> {
  if ((await stat(BIG_FILE).catch(() => undefined))?.size === GIB) return;
  // Unique lines, written in 64 MiB blocks and cut at exactly 1 GiB.
  const file = await open(BIG_FILE, "w");
  try {
    let index = 0;
    const writeFrom = async (written: number): Promise<void> => {
      if (written >= GIB) return;
      let block = "";
      while (block.length < 64 << 20)
        block += `Line ${index++}: ${LINE}: ${(index * 7919).toString(16)}\n`;
      const bytes = Buffer.from(block).subarray(0, GIB - written);
      await file.write(bytes);
      await writeFrom(written + bytes.length);
    };
    await writeFrom(0);
  } finally {
    await file.close();
  }
}

await main();
