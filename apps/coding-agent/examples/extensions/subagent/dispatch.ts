import type { ExtensionContext } from "@msa/coding-agent";
import { Effect } from "effect";

import type { AgentConfig, AgentScope } from "./agents.ts";
import {
  getFinalOutput,
  getResultOutput,
  isFailedResult,
  truncateParallelOutput,
} from "./format.ts";
import { mapWithConcurrencyLimit, runSingleAgent } from "./runner.ts";
import {
  type DispatchDefaults,
  MAX_CONCURRENCY,
  MAX_PARALLEL_TASKS,
  type OnUpdateCallback,
  type SingleResult,
  type SubagentDetails,
} from "./types.ts";

export interface DispatchContext {
  readonly ctx: ExtensionContext;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: OnUpdateCallback | undefined;
  readonly agents: AgentConfig[];
  readonly dispatchDefaults: DispatchDefaults;
  readonly projectAgentsDir: string | null;
  readonly makeDetails: (
    mode: SubagentDetails["mode"],
  ) => (results: SingleResult[]) => SubagentDetails;
}

export interface SubagentParamsValue {
  agent?: string | undefined;
  task?: string | undefined;
  tasks?: { agent: string; task: string; cwd?: string | undefined }[] | undefined;
  chain?: { agent: string; task: string; cwd?: string | undefined }[] | undefined;
  cwd?: string | undefined;
}

const textResult = (
  text: string,
  details: SubagentDetails,
  isError = false,
): { content: { type: "text"; text: string }[]; details: SubagentDetails; isError?: boolean } => ({
  content: [{ text, type: "text" }],
  details,
  ...(isError ? { isError: true } : {}),
});

const requestedAgentNames = (params: SubagentParamsValue): Set<string> => {
  const names = new Set<string>();
  for (const step of params.chain ?? []) names.add(step.agent);
  for (const task of params.tasks ?? []) names.add(task.agent);
  if (params.agent !== undefined && params.agent.length > 0) names.add(params.agent);
  return names;
};

const confirmProjectAgents = (
  context: DispatchContext,
  params: SubagentParamsValue,
  agentScope: AgentScope,
  confirm: boolean,
) =>
  Effect.gen(function* () {
    if (agentScope !== "project" && agentScope !== "both") return true;
    if (!confirm || !context.ctx.hasUI || context.ctx.isProjectTrusted()) return true;

    const requested = Array.from(requestedAgentNames(params))
      .map((name) => context.agents.find((a) => a.name === name))
      .filter((a): a is AgentConfig => a?.source === "project");
    if (requested.length === 0) return true;

    const names = requested.map((a) => a.name).join(", ");
    const dir = context.projectAgentsDir ?? "(unknown)";
    return yield* Effect.promise(() =>
      context.ctx.ui.confirm(
        "Run project-local agents?",
        `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
      ),
    );
  });

const runChainMode = (context: DispatchContext, steps: NonNullable<SubagentParamsValue["chain"]>) =>
  Effect.gen(function* () {
    const results: SingleResult[] = [];
    let previousOutput = "";

    for (const [i, step] of steps.entries()) {
      const taskWithContext = step.task.replace(/\{previous\}/gu, previousOutput);
      const chainUpdate: OnUpdateCallback | undefined =
        context.onUpdate === undefined
          ? undefined
          : (partial) => {
              const currentResult = partial.details?.results[0];
              if (currentResult === undefined) return;
              context.onUpdate?.({
                content: partial.content,
                details: context.makeDetails("chain")([...results, currentResult]),
              });
            };

      const result = yield* Effect.promise(() =>
        runSingleAgent({
          agentName: step.agent,
          agents: context.agents,
          cwd: step.cwd,
          defaultCwd: context.ctx.cwd,
          dispatchDefaults: context.dispatchDefaults,
          makeDetails: context.makeDetails("chain"),
          onUpdate: chainUpdate,
          signal: context.signal,
          step: i + 1,
          task: taskWithContext,
        }),
      );
      results.push(result);

      if (isFailedResult(result)) {
        return textResult(
          `Chain stopped at step ${i + 1} (${step.agent}): ${getResultOutput(result)}`,
          context.makeDetails("chain")(results),
          true,
        );
      }
      previousOutput = getFinalOutput(result.messages);
    }

    return textResult(previousOutput || "(no output)", context.makeDetails("chain")(results));
  });

const emptyResult = (agent: string, task: string): SingleResult => ({
  agent,
  agentSource: "unknown",
  exitCode: -1,
  messages: [],
  stderr: "",
  task,
  usage: { cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, input: 0, output: 0, turns: 0 },
});

const summarizeResults = (results: SingleResult[]): string => {
  const successCount = results.filter((r) => !isFailedResult(r)).length;
  const summaries = results.map((r) => {
    const output = truncateParallelOutput(getResultOutput(r));
    const failed = isFailedResult(r);
    const reason =
      r.stopReason !== undefined && r.stopReason.length > 0 && r.stopReason !== "end"
        ? ` (${r.stopReason})`
        : "";
    const status = failed ? `failed${reason}` : "completed";
    return `### [${r.agent}] ${status}\n\n${output}`;
  });
  return `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`;
};

const emitParallelUpdate = (context: DispatchContext, allResults: SingleResult[]): void => {
  if (context.onUpdate === undefined) return;
  const running = allResults.filter((r) => r.exitCode === -1).length;
  const done = allResults.filter((r) => r.exitCode !== -1).length;
  context.onUpdate({
    content: [
      { text: `Parallel: ${done}/${allResults.length} done, ${running} running...`, type: "text" },
    ],
    details: context.makeDetails("parallel")([...allResults]),
  });
};

const runParallelTask = (
  context: DispatchContext,
  task: { agent: string; task: string; cwd?: string | undefined },
  allResults: SingleResult[],
  index: number,
  emit: () => void,
) =>
  runSingleAgent({
    agentName: task.agent,
    agents: context.agents,
    cwd: task.cwd,
    defaultCwd: context.ctx.cwd,
    dispatchDefaults: context.dispatchDefaults,
    makeDetails: context.makeDetails("parallel"),
    onUpdate: (partial) => {
      const first = partial.details?.results[0];
      if (first === undefined) return;
      allResults[index] = first;
      emit();
    },
    signal: context.signal,
    step: undefined,
    task: task.task,
  }).then((result) => {
    allResults[index] = result;
    emit();
    return result;
  });

const runParallelMode = (
  context: DispatchContext,
  tasks: NonNullable<SubagentParamsValue["tasks"]>,
) =>
  Effect.gen(function* () {
    if (tasks.length > MAX_PARALLEL_TASKS) {
      return textResult(
        `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
        context.makeDetails("parallel")([]),
      );
    }

    const allResults = tasks.map((task) => emptyResult(task.agent, task.task));

    const results = yield* Effect.promise(() =>
      mapWithConcurrencyLimit({
        concurrency: MAX_CONCURRENCY,
        items: tasks,
        run: (task, index) =>
          runParallelTask(context, task, allResults, index, () =>
            emitParallelUpdate(context, allResults),
          ),
      }),
    );

    return textResult(summarizeResults(results), context.makeDetails("parallel")(results));
  });

const runSingleMode = (context: DispatchContext, params: SubagentParamsValue) =>
  Effect.gen(function* () {
    const agentName = params.agent ?? "";
    const task = params.task ?? "";
    const result = yield* Effect.promise(() =>
      runSingleAgent({
        agentName,
        agents: context.agents,
        cwd: params.cwd,
        defaultCwd: context.ctx.cwd,
        dispatchDefaults: context.dispatchDefaults,
        makeDetails: context.makeDetails("single"),
        onUpdate: context.onUpdate,
        signal: context.signal,
        step: undefined,
        task,
      }),
    );

    if (isFailedResult(result)) {
      return textResult(
        `Agent ${result.stopReason || "failed"}: ${getResultOutput(result)}`,
        context.makeDetails("single")([result]),
        true,
      );
    }
    return textResult(
      getFinalOutput(result.messages) || "(no output)",
      context.makeDetails("single")([result]),
    );
  });

export const dispatch = (request: {
  readonly context: DispatchContext;
  readonly params: SubagentParamsValue;
  readonly agentScope: AgentScope;
  readonly confirm: boolean;
}) =>
  Effect.gen(function* () {
    const { context, params, agentScope, confirm } = request;
    const hasChain = (params.chain?.length ?? 0) > 0;
    const hasTasks = (params.tasks?.length ?? 0) > 0;
    const hasSingle = Boolean(params.agent && params.task);
    const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

    if (modeCount !== 1) {
      const available = context.agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
      return textResult(
        `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
        context.makeDetails("single")([]),
      );
    }

    const approved = yield* confirmProjectAgents(context, params, agentScope, confirm);
    if (!approved) {
      const mode = hasChain ? "chain" : hasTasks ? "parallel" : "single";
      return textResult(
        "Canceled: project-local agents not approved.",
        context.makeDetails(mode)([]),
      );
    }

    if (params.chain !== undefined && params.chain.length > 0) {
      return yield* runChainMode(context, params.chain);
    }
    if (params.tasks !== undefined && params.tasks.length > 0) {
      return yield* runParallelMode(context, params.tasks);
    }
    return yield* runSingleMode(context, params);
  });
