import { NodeServices } from "@effect/platform-node";
import type aiTypes from "@msa/ai/index.types";
import { Effect, FileSystem, ManagedRuntime, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type { AgentConfig } from "./agents.ts";
import { getFinalOutput } from "./format.ts";
import type { DispatchDefaults, OnUpdateCallback, SingleResult, SubagentDetails } from "./types.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fsService = runtime.runSync(FileSystem.FileSystem);
const pathService = runtime.runSync(Path.Path);

export const mapWithConcurrencyLimit = <TIn, TOut>(request: {
  readonly items: TIn[];
  readonly concurrency: number;
  readonly run: (item: TIn, index: number) => Promise<TOut>;
}): Promise<TOut[]> => {
  const { items, concurrency, run } = request;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  return runtime.runPromise(
    Effect.forEach(items, (item, index) => Effect.promise(() => run(item, index)), {
      concurrency: limit,
    }),
  );
};

const writePromptToTempFile = (agentName: string, prompt: string) =>
  Effect.gen(function* () {
    const dir = yield* fsService.makeTempDirectory({ prefix: "msa-subagent-" });
    const safeName = agentName.replace(/[^\w.-]+/gu, "_");
    const filePath = pathService.join(dir, `prompt-${safeName}.md`);
    yield* fsService.writeFileString(filePath, prompt, { mode: 0o600 });
    return { dir, filePath };
  });

const removeTempPrompt = (tmp: { dir: string } | undefined) =>
  tmp === undefined
    ? Effect.void
    : fsService.remove(tmp.dir, { recursive: true }).pipe(Effect.ignore);

const scriptExists = (currentScript: string | undefined) =>
  currentScript === undefined ||
  currentScript.length === 0 ||
  currentScript.startsWith("/$bunfs/root/")
    ? Effect.succeed(false)
    : fsService.exists(currentScript).pipe(Effect.orElseSucceed(() => false));

const getMsaInvocation = (args: string[]) =>
  Effect.gen(function* () {
    const currentScript = process.argv[1];
    if (currentScript !== undefined && (yield* scriptExists(currentScript))) {
      return { args: [currentScript, ...args], command: process.execPath };
    }

    const execName = pathService.basename(process.execPath).toLowerCase();
    if (!/^(node|bun)(\.exe)?$/u.test(execName)) {
      return { args, command: process.execPath };
    }
    return { args, command: "msa" };
  });

const buildArgs = (
  agent: AgentConfig,
  task: string,
  dispatchDefaults: DispatchDefaults,
  promptPath: string | undefined,
): string[] => {
  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  const inheritsDispatchConfig = agent.model === undefined || agent.model.length === 0;
  const model = agent.model ?? dispatchDefaults.model;
  if (model !== undefined && model.length > 0) args.push("--model", model);
  if (inheritsDispatchConfig && dispatchDefaults.thinkingLevel !== undefined) {
    args.push("--thinking", dispatchDefaults.thinkingLevel);
  }
  if (agent.tools !== undefined && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }
  if (promptPath !== undefined) args.push("--append-system-prompt", promptPath);
  args.push(`Task: ${task}`);
  return args;
};

const applyMessage = (result: SingleResult, msg: aiTypes.Message): void => {
  result.messages.push(msg);
  if (msg.role !== "assistant") return;

  result.usage.turns++;
  const usage = msg.usage;
  result.usage.input += usage.input || 0;
  result.usage.output += usage.output || 0;
  result.usage.cacheRead += usage.cacheRead || 0;
  result.usage.cacheWrite += usage.cacheWrite || 0;
  result.usage.cost += usage.cost?.total || 0;
  result.usage.contextTokens = usage.totalTokens || 0;
  if (result.model === undefined || (result.model.length === 0 && msg.model.length > 0)) {
    result.model = msg.model;
  }
  result.stopReason = msg.stopReason;
  if (msg.errorMessage !== undefined && msg.errorMessage.length > 0) {
    result.errorMessage = msg.errorMessage;
  }
};

const applyEvent = (result: SingleResult, line: string, emitUpdate: () => void): void => {
  if (line.trim().length === 0) return;

  let event: { type?: string; message?: unknown };
  try {
    event = JSON.parse(line) as { type?: string; message?: unknown };
  } catch {
    return;
  }

  if (event.type === "message_end" && event.message !== undefined) {
    applyMessage(result, event.message as aiTypes.Message);
    emitUpdate();
    return;
  }
  if (event.type === "tool_result_end" && event.message !== undefined) {
    result.messages.push(event.message as aiTypes.Message);
    emitUpdate();
  }
};

interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onLine: (line: string) => void;
  readonly onStderr: (text: string) => void;
}

const runSubagentProcess = (request: SpawnRequest) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(request.command, [...request.args], {
            cwd: request.cwd,
            stdin: "ignore",
          }),
        );

        yield* Effect.forkScoped(
          Stream.runForEach(Stream.splitLines(Stream.decodeText(handle.stdout)), (line) =>
            Effect.sync(() => request.onLine(line)),
          ),
        );
        yield* Effect.forkScoped(
          Stream.runForEach(Stream.decodeText(handle.stderr), (chunk) =>
            Effect.sync(() => request.onStderr(chunk)),
          ),
        );

        return yield* handle.exitCode;
      }),
    );
  });

export interface RunSingleRequest {
  readonly defaultCwd: string;
  readonly dispatchDefaults: DispatchDefaults;
  readonly agents: AgentConfig[];
  readonly agentName: string;
  readonly task: string;
  readonly cwd: string | undefined;
  readonly step: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: OnUpdateCallback | undefined;
  readonly makeDetails: (results: SingleResult[]) => SubagentDetails;
}

const emptyUsage = () => ({
  cacheRead: 0,
  cacheWrite: 0,
  contextTokens: 0,
  cost: 0,
  input: 0,
  output: 0,
  turns: 0,
});

const unknownAgentResult = (request: RunSingleRequest): SingleResult => {
  const available = request.agents.map((a) => `"${a.name}"`).join(", ") || "none";
  return {
    agent: request.agentName,
    agentSource: "unknown",
    exitCode: 1,
    messages: [],
    stderr: `Unknown agent: "${request.agentName}". Available agents: ${available}.`,
    step: request.step,
    task: request.task,
    usage: emptyUsage(),
  };
};

const makeResult = (request: RunSingleRequest, agent: AgentConfig): SingleResult => ({
  agent: request.agentName,
  agentSource: agent.source,
  exitCode: 0,
  messages: [],
  model: agent.model ?? request.dispatchDefaults.model,
  stderr: "",
  step: request.step,
  task: request.task,
  usage: emptyUsage(),
});

const finishResult = (
  result: SingleResult,
  exitCode: number,
  signal: AbortSignal | undefined,
): SingleResult => {
  result.exitCode = exitCode;
  if (signal?.aborted === true) throw new Error("Subagent was aborted");
  return result;
};

export const runSingleAgent = (request: RunSingleRequest): Promise<SingleResult> => {
  const agent = request.agents.find((a) => a.name === request.agentName);
  if (agent === undefined) return Promise.resolve(unknownAgentResult(request));

  const currentResult = makeResult(request, agent);
  const emitUpdate = () => {
    request.onUpdate?.({
      content: [{ text: getFinalOutput(currentResult.messages) || "(running...)", type: "text" }],
      details: request.makeDetails([currentResult]),
    });
  };

  return runtime.runPromise(
    Effect.acquireUseRelease(
      agent.systemPrompt.trim().length > 0
        ? writePromptToTempFile(agent.name, agent.systemPrompt)
        : Effect.succeed(undefined),
      (tmp) =>
        Effect.gen(function* () {
          const args = buildArgs(agent, request.task, request.dispatchDefaults, tmp?.filePath);
          const invocation = yield* getMsaInvocation(args);
          const exitCode = yield* runSubagentProcess({
            args: invocation.args,
            command: invocation.command,
            cwd: request.cwd ?? request.defaultCwd,
            onLine: (line) => applyEvent(currentResult, line, emitUpdate),
            onStderr: (text) => {
              currentResult.stderr += text;
            },
            signal: request.signal,
          });
          return finishResult(currentResult, Number(exitCode), request.signal);
        }),
      removeTempPrompt,
    ),
  );
};
