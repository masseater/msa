import type agentTypes from "@msa/agent-core/index.types";
import codemode from "@msa/codemode";
import type codemodeTypes from "@msa/codemode/index.types";
import * as Effect from "effect/Effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import discoveryGlobals from "./discovery-globals.ts";
import modelGlobals from "./model-globals.ts";
import scriptText from "./script-text.ts";
import type toolTypes from "./tool.types.ts";

const { awaited, awaiting } = awaitingModule;
const { getCodemodeWorkerSpecifier, getQuickJSWasmPath } = config;
const { createDiscoveryGlobals } = discoveryGlobals;
const { createModelGlobals } = modelGlobals;
const { ERROR_PREVIEW_CHARS, previewArgs, textOf, toScriptValue, truncateText } = scriptText;

const CODEMODE_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
const MAX_CONCURRENT_CODEMODE_WORKERS = 2;
let activeCodemodeWorkers = 0;

interface SandboxRun {
  toolCallId: string;
  ctx: toolTypes.CodemodeRunContext | undefined;
  options: toolTypes.CodemodeToolOptions;
  calls: toolTypes.CodemodeNestedCall[];
  publish: () => void;
  addModelUsage: (usage: toolTypes.CodemodeUsage) => void;
  addGeneratedImages: (count: number) => void;
}

const acquireWorker = () => {
  if (activeCodemodeWorkers >= MAX_CONCURRENT_CODEMODE_WORKERS) {
    throw new Error(
      `Codemode worker limit reached (${MAX_CONCURRENT_CODEMODE_WORKERS} workers are still running or shutting down). Retry after they exit.`,
    );
  }
  activeCodemodeWorkers++;
  return () => {
    activeCodemodeWorkers--;
  };
};

function recordOutcome(
  record: toolTypes.CodemodeNestedCall,
  tool: agentTypes.AgentTool<any>,
  outcome: agentTypes.AgentToolCallOutcome,
  aborted: boolean,
): void {
  record.id = outcome.toolCall.id;
  if (!outcome.isError) {
    record.status = "ok";
    return;
  }
  record.status = aborted ? "cancelled" : "error";
  record.error = truncateText(
    textOf(outcome.result) || `Tool "${tool.name}" failed`,
    ERROR_PREVIEW_CHARS,
  );
}

function sandboxTool(
  run: SandboxRun,
  tool: agentTypes.AgentTool<any>,
  description: string | undefined,
): codemodeTypes.CodemodeTool {
  return {
    name: tool.name,
    ...(description === undefined ? {} : { description }),
    execute: (args, { signal: callSignal }) =>
      Effect.runPromise(
        awaiting(function* () {
          const record: toolTypes.CodemodeNestedCall = {
            args: previewArgs(args),
            id: `${run.toolCallId}/?`,
            name: tool.name,
            status: "running",
          };
          run.calls.push(record);
          run.publish();
          const callStartedAt = performance.now();
          if (run.ctx === undefined) throw new Error("Tool calls need a session");
          const outcome = yield* awaited(
            run.ctx.executeTool(tool.name, args, { signal: callSignal }),
          );
          record.durationMs = performance.now() - callStartedAt;
          recordOutcome(record, tool, outcome, callSignal.aborted);
          run.publish();
          return toScriptValue(tool, outcome);
        }),
      ),
  };
}

function createSandbox(
  run: SandboxRun,
  callable: readonly agentTypes.AgentTool<any>[],
  samples: ReadonlyMap<string, string>,
  timeoutMs: number,
): Promise<codemodeTypes.CodemodeSandbox> {
  return getCodemodeWorkerSpecifier().then((workerUrl) =>
    sandboxFor({ callable, run, samples, timeoutMs, workerUrl }),
  );
}

function sandboxFor(parts: {
  readonly run: SandboxRun;
  readonly callable: readonly agentTypes.AgentTool<any>[];
  readonly samples: ReadonlyMap<string, string>;
  readonly timeoutMs: number;
  readonly workerUrl: string | URL | undefined;
}): codemodeTypes.CodemodeSandbox {
  const { callable, run, samples, timeoutMs, workerUrl } = parts;
  const { ctx, options } = run;
  return new codemode.CodemodeSandbox({
    globals: [
      ...createDiscoveryGlobals(callable, samples, options),
      ...(options.models === true && ctx !== undefined
        ? createModelGlobals(
            ctx.modelRegistry,
            run.toolCallId,
            run.calls,
            run.publish,
            run.addModelUsage,
            run.addGeneratedImages,
          )
        : []),
    ],
    memoryLimitBytes: CODEMODE_MEMORY_LIMIT_BYTES,
    timeoutMs,
    tools: callable.map((tool) => sandboxTool(run, tool, samples.get(tool.name))),
    wasm: codemode.loadQuickJSWasm(getQuickJSWasmPath()),
    ...(workerUrl === undefined ? {} : { workerUrl }),
    acquireWorker,
  });
}

const codemodeSandbox = { createSandbox };

export default codemodeSandbox;
