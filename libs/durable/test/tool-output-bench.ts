import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Console, Effect } from "effect";

import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import toolOutputScenario from "./tool-output-scenario.ts";
import type toolOutputScenarioTypes from "./tool-output-scenario.types.ts";

const { fromJsonText, toJsonText } = effectSupport;
const { fileSize, pathExists, runCommandOrFail, writeChunks } = platformSupport;
const { BIG_FILE, GIB, LINE, runScenario } = toolOutputScenario;

const main = Effect.fn("main")(function* () {
  const [, , encoded] = process.argv;
  if (encoded !== undefined) {
    const result = yield* runScenario(
      (yield* fromJsonText(encoded)) as toolOutputScenarioTypes.Scenario,
    );
    process.stdout.write(`${yield* toJsonText(result)}\n`);
    return;
  }
  const scenarios: toolOutputScenarioTypes.Scenario[] = [];
  for (const backend of ["memory", "sqlite", "jsonl"] as const) {
    for (const rate of ["low", "normal", "high"] as const) {
      for (const retain of ["head", "tail"] as const) {
        for (const tools of [1, 4]) scenarios.push({ backend, kind: "rate", rate, retain, tools });
      }
    }
    for (const retain of ["head", "tail"] as const)
      scenarios.push({ backend, kind: "firehose", retain });
    scenarios.push({ backend, kind: "firehose", repetitive: true, retain: "tail" });
    if (backend !== "memory")
      scenarios.push({
        backend,
        kind: "rate",
        rate: "high",
        retain: "tail",
        seconds: 30,
        tools: 1,
      });
    scenarios.push({ backend, kind: "cat" });
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

function label(scenario: toolOutputScenarioTypes.Scenario): Record<string, unknown> {
  if (scenario.kind === "rate") {
    const { backend, rate, retain, tools, seconds } = scenario;
    return {
      backend,
      scenario: `${rate} ${retain} x${tools}${seconds === undefined ? "" : ` ${seconds}s`}`,
    };
  }
  if (scenario.kind === "cat") return { backend: scenario.backend, scenario: "bash cat 1 GiB" };
  const repetitive = scenario.repetitive === true ? " repetitive" : "";
  return {
    backend: scenario.backend,
    scenario: `api.output 1 GiB ${scenario.retain}${repetitive}`,
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
