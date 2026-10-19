import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Console, Effect } from "effect";

import { fromJsonText, toJsonText } from "./effect-support.ts";
import { fileSize, pathExists, runCommandOrFail, writeChunks } from "./platform-support.ts";
import { BIG_FILE, GIB, LINE, runScenario, type Scenario } from "./tool-output-scenario.ts";

const main = Effect.fn("main")(function* () {
  const [, , encoded] = process.argv;
  if (encoded !== undefined) {
    const result = yield* runScenario((yield* fromJsonText(encoded)) as Scenario);
    process.stdout.write(`${yield* toJsonText(result)}\n`);
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
    scenarios.push({ kind: "firehose", backend, retain: "tail", repetitive: true });
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
  yield* ensureBigFile();
  const rows: Record<string, unknown>[] = [];
  for (const scenario of scenarios) {
    const stdout = yield* runCommandOrFail(process.execPath, [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      yield* toJsonText(scenario),
    ]);
    const measured = (yield* fromJsonText(stdout.trim().split("\n").at(-1)!)) as Record<
      string,
      unknown
    >;
    rows.push({ ...label(scenario), ...measured });
  }
  yield* Console.table(rows);
});

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

function* bigFileBlocks(): Generator<Uint8Array> {
  let index = 0;
  for (let written = 0; written < GIB;) {
    let block = "";
    while (block.length < 64 << 20)
      block += `Line ${index++}: ${LINE}: ${(index * 7919).toString(16)}\n`;
    const bytes = Buffer.from(block).subarray(0, GIB - written);
    written += bytes.length;
    yield bytes;
  }
}

const ensureBigFile = Effect.fn("ensureBigFile")(function* () {
  if ((yield* pathExists(BIG_FILE)) && (yield* fileSize(BIG_FILE)) === GIB) return;
  yield* writeChunks(BIG_FILE, bigFileBlocks());
});

NodeRuntime.runMain(main());
