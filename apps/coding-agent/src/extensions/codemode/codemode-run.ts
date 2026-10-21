import codemode from "@msa/codemode";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import usageTotals from "../../core/usage-totals.ts";
import codemodeSandbox from "./codemode-sandbox.ts";
import codemodeStore from "./codemode-store.ts";
import scriptOutput from "./script-output.ts";
import toolModule from "./tool.ts";
import type toolTypes from "./tool.types.ts";

const { CODEMODE_STORE_ENTRY_TYPE, getCodemodeCallableTools, toCodemodeDeclaration } = toolModule;
const { awaited, awaiting } = awaitingModule;
const { combineUsage } = usageTotals;
const { createSandbox } = codemodeSandbox;
const { readCodemodeStore } = codemodeStore;
const { renderScriptResult } = scriptOutput;
const { parseCodemodeSource, renderToolSample } = codemode;

type SandboxRun = Parameters<typeof createSandbox>[0];

interface CodemodeCall {
  toolCallId: string;
  input: toolTypes.CodemodeToolInput;
  signal: AbortSignal | undefined;
  onUpdate: ((result: toolTypes.CodemodeRunResult) => void) | undefined;
  ctx: toolTypes.CodemodeRunContext | undefined;
  options: toolTypes.CodemodeToolOptions;
}

function startRun(call: CodemodeCall) {
  const calls: toolTypes.CodemodeNestedCall[] = [];
  const totals: { images: number; usage: toolTypes.CodemodeUsage | undefined } = {
    images: 0,
    usage: undefined,
  };
  const run: SandboxRun = {
    addGeneratedImages: (count) => {
      totals.images += count;
    },
    addModelUsage: (usage) => {
      totals.usage = totals.usage === undefined ? usage : combineUsage(totals.usage, usage);
    },
    calls,
    ctx: call.ctx,
    options: call.options,
    publish: () =>
      call.onUpdate?.({
        content: [],
        details: { calls: calls.map((entry) => structuredClone(entry)) },
      }),
    toolCallId: call.toolCallId,
  };
  return { run, totals };
}

function toolSamples(
  callable: ReturnType<typeof getCodemodeCallableTools>,
  options: toolTypes.CodemodeToolOptions,
): ReadonlyMap<string, string> {
  const guidelines = options.getToolGuidelines?.();
  return new Map(
    callable.map((tool) => [
      tool.name,
      renderToolSample(toCodemodeDeclaration(tool, guidelines?.get(tool.name))),
    ]),
  );
}

function persistStoreWrites(
  result: Awaited<ReturnType<ReturnType<typeof createSandbox>["execute"]>>,
  options: toolTypes.CodemodeToolOptions,
): void {
  if (!result.ok) return;
  const { set, delete: deleted } = result.storeWrites;
  if (Object.keys(set).length > 0 || deleted.length > 0) {
    options.appendEntry?.(CODEMODE_STORE_ENTRY_TYPE, { delete: deleted, set });
  }
}

const runCodemode = (call: CodemodeCall): Promise<toolTypes.CodemodeRunResult> =>
  Effect.runPromise(
    awaiting(function* () {
      const startedAt = performance.now();
      const { code, options: sourceOptions } = parseCodemodeSource(call.input.code);
      const { run, totals } = startRun(call);
      run.publish();
      const callable = call.ctx === undefined ? [] : getCodemodeCallableTools(call.ctx.tools);
      const timeoutMs = sourceOptions.timeoutMs ?? Number.POSITIVE_INFINITY;
      const sandbox = createSandbox(run, callable, toolSamples(callable, call.options), timeoutMs);
      let result: Awaited<ReturnType<typeof sandbox.execute>>;
      try {
        const store =
          call.ctx === undefined ? {} : readCodemodeStore(call.ctx.sessionManager.getBranch());
        const { signal } = call;
        result = yield* awaited(
          sandbox.execute(code, { ...(signal === undefined ? {} : { signal }), store }),
        );
      } finally {
        yield* awaited(sandbox.close());
      }
      for (const entry of run.calls) {
        if (entry.status === "running") entry.status = "cancelled";
      }
      persistStoreWrites(result, call.options);
      return yield* awaited(
        renderScriptResult({
          calls: run.calls,
          generatedImages: totals.images,
          maxOutputTokens: sourceOptions.maxOutputTokens,
          result,
          startedAt,
          usage: totals.usage,
        }),
      );
    }),
  );

const codemodeRun = { runCodemode };

export default codemodeRun;
