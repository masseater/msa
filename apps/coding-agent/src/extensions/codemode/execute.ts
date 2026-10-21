import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import codemode from "@msa/codemode";
import type codemodeTypes from "@msa/codemode/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import type typesToolsTypes from "../../core/extensions/types-tools.types.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type sessionManagerTypes from "../../core/session-manager.types.ts";
import truncate from "../../core/tools/truncate.ts";
import usageTotals from "../../core/usage-totals.ts";
import errors from "../../utils/errors.ts";
import interop from "../../utils/interop.ts";
import outputFiles from "../../utils/output-files.ts";
import Bm25Ranker from "../tool-search/bm-25-ranker.ts";
import toolSearchTool from "../tool-search/tool.ts";
import toolModule from "./tool.ts";
import type toolTypes from "./tool.types.ts";

const {
  CODEMODE_DOCS_PATH,
  CODEMODE_STORE_ENTRY_TYPE,
  getCodemodeCallableTools,
  toCodemodeDeclaration,
} = toolModule;
const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { writeOutputFile } = outputFiles;
const { toErrorMessage } = errors;
const { formatSize } = truncate;
const { combineUsage } = usageTotals;
const { getCodemodeWorkerSpecifier, getQuickJSWasmPath } = config;
const { DEFAULT_TOOL_SEARCH_LIMIT, createToolSearchDocument } = toolSearchTool;

const { CodemodeSandbox, parseCodemodeSource, renderToolSample, toCodemodeIdentifier } = codemode;

const ARGS_PREVIEW_CHARS = 200;
const ERROR_PREVIEW_CHARS = 500;

const MAX_CONCURRENT_MODEL_CALLS = 4;

const CODEMODE_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

const MAX_CONCURRENT_CODEMODE_WORKERS = 2;
let activeCodemodeWorkers = 0;
const MODEL_TYPES: ReadonlySet<string> = new Set<aiTypes.ModelType>([
  "chat",
  "image",
  "classifier",
]);

function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

function previewArgs(args: unknown): string {
  if (args === undefined) return "";
  try {
    return truncateText(JSON.stringify(args) ?? "", ARGS_PREVIEW_CHARS);
  } catch {
    return "";
  }
}

function textOf(result: agentTypes.AgentToolResult<unknown>): string {
  return (result.content ?? [])
    .filter((block): block is aiTypes.TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function toModelType(value: unknown): aiTypes.ModelType {
  if (typeof value === "string" && MODEL_TYPES.has(value)) return value as aiTypes.ModelType;
  throw new Error(
    `Unknown model type ${JSON.stringify(value)}. Use "chat", "image", or "classifier".`,
  );
}

function toProvider(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("provider must be a string");
  return value;
}

function toModelInfo(model: aiTypes.AnyModel): Record<string, unknown> {
  const info: Record<string, unknown> = { ...model };
  delete info["headers"];
  return info;
}

function withArticle(word: string): string {
  return `${/^[aeiou]/u.test(word) ? "an" : "a"} ${word}`;
}

type ScriptValue = { readonly [key: string]: unknown } | null | undefined;

function describeValue(value: unknown): string {
  if (value === undefined || value === null) return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "an empty array" : "an array";
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    return `{ ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", ..." : ""} }`;
  }
  return typeof value === "string" ? "a string" : `a ${typeof value}`;
}

const CLASSIFIER_CONTEXT_SHAPE =
  '{ state: { ... }, images?: [{ type: "image", data: <base64>, mimeType }], questions: { <id>: { type: "choice", instructions, criteria: { <label>: <meaning> } } | { type: "score", instructions, criteria: [<lowest level>, ..., <highest level>] } | { type: "bool", instructions, criteria: { true: <meaning>, false: <meaning> } } } }';

function checkClassifierContext(context: unknown): aiTypes.ClassifierContext {
  const fail = (problem: string) =>
    new Error(
      `models.classify() ${problem}. Expected context: ${CLASSIFIER_CONTEXT_SHAPE}. See "Classify" in ${CODEMODE_DOCS_PATH}.`,
    );
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw fail(`expects a context object as its second argument, got ${describeValue(context)}`);
  }
  const { state, images, questions } = context as Record<string, unknown>;
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw fail(`context.state must be an object, got ${describeValue(state)}`);
  }
  if (images !== undefined) {
    if (!Array.isArray(images))
      throw fail(`context.images must be an array, got ${describeValue(images)}`);
    images.forEach((image: ScriptValue, index) => {
      if (
        image?.["type"] !== "image" ||
        typeof image["data"] !== "string" ||
        typeof image["mimeType"] !== "string"
      ) {
        throw fail(`context.images[${index}] must be an image block, got ${describeValue(image)}`);
      }
    });
  }
  if (
    typeof questions !== "object" ||
    questions === null ||
    Array.isArray(questions) ||
    Object.keys(questions).length === 0
  ) {
    throw fail(
      `context.questions must map question IDs to questions, got ${describeValue(questions)}`,
    );
  }
  const isStrings = (values: unknown[]) =>
    values.length > 0 && values.every((value) => typeof value === "string");
  for (const [id, question] of Object.entries(questions)) {
    const at = `context.questions.${id}`;
    if (typeof question !== "object" || question === null || Array.isArray(question)) {
      throw fail(`${at} must be a question object, got ${describeValue(question)}`);
    }
    const { type, instructions, criteria } = question as Record<string, unknown>;
    checkClassifierQuestion(instructions, fail, at, type, criteria, isStrings);
  }
  return context as unknown as aiTypes.ClassifierContext;
}

function checkClassifierQuestion(
  instructions: unknown,
  fail: (problem: string) => Error,
  at: string,
  type: unknown,
  criteria: unknown,
  isStrings: (values: unknown[]) => boolean,
) {
  if (typeof instructions !== "string") throw fail(`${at}.instructions must be a string`);
  if (type === "choice") {
    if (
      typeof criteria !== "object" ||
      criteria === null ||
      Array.isArray(criteria) ||
      !isStrings(Object.values(criteria))
    ) {
      throw fail(`${at} is a "choice" question, so criteria must map each label to its meaning`);
    }
  } else if (type === "score") {
    if (!Array.isArray(criteria) || !isStrings(criteria)) {
      throw fail(
        `${at} is a "score" question, so criteria must list the levels as strings, lowest first`,
      );
    }
  } else if (type === "bool") {
    const labels = criteria as ScriptValue;
    if (typeof labels?.["true"] !== "string" || typeof labels["false"] !== "string") {
      throw fail(`${at} is a "bool" question, so criteria must be { true: string, false: string }`);
    }
  } else {
    throw fail(`${at}.type must be "choice", "score", or "bool", got ${JSON.stringify(type)}`);
  }
}

function checkImagesContext(context: unknown): aiTypes.ImagesContext {
  const fail = (problem: string) =>
    new Error(
      `models.generateImages() ${problem}. Expected context: { input: [{ type: "text", text: <prompt> }, ...optional { type: "image", data: <base64>, mimeType } references] }. See "Generate images" in ${CODEMODE_DOCS_PATH}.`,
    );
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw fail(`expects a context object as its second argument, got ${describeValue(context)}`);
  }
  const { input } = context as Record<string, unknown>;
  if (!Array.isArray(input) || input.length === 0) {
    throw fail(`context.input must be a non-empty array of blocks, got ${describeValue(input)}`);
  }
  input.forEach((block: ScriptValue, index) => {
    if (block?.["type"] === "text" && typeof block["text"] === "string") return;
    if (
      block?.["type"] === "image" &&
      typeof block["data"] === "string" &&
      typeof block["mimeType"] === "string"
    )
      return;
    throw fail(
      `context.input[${index}] must be a text or image block, got ${describeValue(block)}`,
    );
  });
  return context as unknown as aiTypes.ImagesContext;
}

interface ModelCallResult {
  stopReason: "stop" | "error" | "aborted";
  errorMessage?: string;
  usage?: aiTypes.Usage;
}

function createLimiter(limit: number): <T>(run: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return (run) =>
    Effect.runPromise(
      awaiting(function* () {
        if (active >= limit)
          yield* awaited(callbackPromise<void>((resolve) => waiting.push(resolve)));
        active++;
        try {
          return yield* awaited(run());
        } finally {
          active--;
          waiting.shift()?.();
        }
      }),
    );
}

function isStoreEntryData(data: unknown): data is toolTypes.CodemodeStoreEntryData {
  if (typeof data !== "object" || data === null) return false;
  const { set, delete: deleted } = data as Partial<toolTypes.CodemodeStoreEntryData>;
  return (
    typeof set === "object" &&
    set !== null &&
    Array.isArray(deleted) &&
    deleted.every((key: unknown) => typeof key === "string")
  );
}

function readCodemodeStore(
  branch: readonly sessionManagerTypes.SessionEntry[],
): Record<string, unknown> {
  const store = new Map<string, unknown>();
  for (const entry of branch) {
    if (
      entry.type !== "custom" ||
      entry.customType !== CODEMODE_STORE_ENTRY_TYPE ||
      !isStoreEntryData(entry.data)
    ) {
      continue;
    }
    for (const key of entry.data.delete) store.delete(key);
    for (const [key, value] of Object.entries(entry.data.set)) store.set(key, value);
  }
  return Object.fromEntries(store);
}

const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;

const CHARS_PER_TOKEN = 4;

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function formatOutput(
  output: readonly codemodeTypes.CodemodeOutputItem[],
): (aiTypes.TextContent | aiTypes.ImageContent)[] {
  const total = output.filter((item) => item.type === "text" && item.console === undefined).length;
  const items: (aiTypes.TextContent | aiTypes.ImageContent)[] = [];
  const consoleLines: string[] = [];
  let index = 0;
  for (const item of output) {
    if (item.type === "image") {
      items.push(item);
    } else if (item.console === undefined) {
      index++;
      items.push({
        text: total > 1 ? `==> text ${index}/${total} <==\n${item.text}` : item.text,
        type: "text",
      });
    } else {
      consoleLines.push(item.text);
    }
  }
  if (consoleLines.length > 0) {
    items.push({
      text: `<console_output>\n${consoleLines.join("\n")}\n</console_output>`,
      type: "text",
    });
  }
  return items;
}

function joinAdjacentText(
  items: (aiTypes.TextContent | aiTypes.ImageContent)[],
): (aiTypes.TextContent | aiTypes.ImageContent)[] {
  const joined: (aiTypes.TextContent | aiTypes.ImageContent)[] = [];
  let parts: string[] = [];
  let lastPart = "";
  const flush = () => {
    if (parts.length > 0) joined.push({ text: parts.join(""), type: "text" });
    parts = [];
    lastPart = "";
  };
  for (const item of items) {
    if (item.type !== "text") {
      flush();
      joined.push(item);
      continue;
    }
    if (lastPart !== "" && !lastPart.endsWith("\n")) {
      parts.push("\n");
      lastPart = "\n";
    }
    parts.push(item.text);
    if (item.text !== "") lastPart = item.text;
  }
  flush();
  return joined;
}

function formatCallSummary(calls: readonly toolTypes.CodemodeNestedCall[]): string {
  if (calls.length === 0) return "No tool calls were made.";
  return `Tool calls made before the failure (they are not undone): ${calls.map((call) => `${call.name} (${call.status})`).join(", ")}`;
}

function formatError(
  result: Extract<codemodeTypes.CodemodeResult, { ok: false }>,
  calls: readonly toolTypes.CodemodeNestedCall[],
): string {
  const { error } = result;
  const head =
    error.kind === "script"
      ? (error.stack ?? `${error.name ?? "Error"}: ${error.message}`)
      : error.kind === "timeout"
        ? `Script timed out: ${error.message}`
        : error.kind === "aborted"
          ? `Script aborted: ${error.message}`
          : `Script sandbox failed: ${error.message}`;
  return `${head}\n\n${formatCallSummary(calls)}`;
}

function spillOutput(text: string): Promise<{ path: string } | { error: string }> {
  return Effect.runPromise(
    awaiting(function* () {
      try {
        return { path: yield* awaited(writeOutputFile("msa-codemode", ".txt", text)) };
      } catch (error) {
        return { error: toErrorMessage(error) };
      }
    }),
  );
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function saveImages(
  items: (aiTypes.TextContent | aiTypes.ImageContent)[],
): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> {
  return Effect.runPromise(
    awaiting(function* () {
      const labels = new Map<string, Promise<string>>();
      const label = ({ data, mimeType }: aiTypes.ImageContent): Promise<string> =>
        Effect.runPromise(
          awaiting(function* () {
            const bytes = Buffer.from(data, "base64");
            const kind = `${mimeType}, ${formatSize(bytes.length)}`;
            const extension = IMAGE_EXTENSIONS[mimeType];
            if (extension === undefined || extension === "")
              throw new Error(`No file extension for image type ${mimeType}`);

            try {
              const path = yield* awaited(writeOutputFile("msa-codemode", extension, bytes));
              return `[Image saved to ${path} (${kind})]`;
            } catch (error) {
              return `[Image (${kind}) could not be saved: ${toErrorMessage(error)}]`;
            }
          }),
        );
      const result = yield* awaited(
        Promise.all(
          items.map((item): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> =>
            Effect.runPromise(
              awaiting(function* () {
                if (item.type !== "image") return [item];
                let pending = labels.get(item.data);
                if (pending === undefined) {
                  pending = label(item);
                  labels.set(item.data, pending);
                }
                return [{ text: yield* awaited(pending), type: "text" }, item];
              }),
            ),
          ),
        ),
      );
      return result.flat();
    }),
  );
}

function truncateOutput(
  items: (aiTypes.TextContent | aiTypes.ImageContent)[],
  maxTokens: number,
): Promise<{ items: (aiTypes.TextContent | aiTypes.ImageContent)[]; fullOutputPath?: string }> {
  return Effect.runPromise(
    awaiting(function* () {
      const texts = items
        .filter((item): item is aiTypes.TextContent => item.type === "text")
        .map((item) => item.text);
      const combined = texts.join("\n");
      const budget = maxTokens * CHARS_PER_TOKEN;
      if (texts.length === 0 || combined.length <= budget) return { items };
      const headChars = Math.floor(budget / 2);
      const tailChars = budget - headChars;
      const removed = combined.length - headChars - tailChars;
      const head = combined.slice(0, headChars);
      const tail = tailChars > 0 ? combined.slice(-tailChars) : "";
      let text = `Warning: truncated output (original token count: ${Math.ceil(combined.length / CHARS_PER_TOKEN)})\nTotal output lines: ${combined.split("\n").length}\n\n${head}…${Math.ceil(removed / CHARS_PER_TOKEN)} tokens truncated…${tail}`;
      const spilled = yield* awaited(spillOutput(combined));
      text +=
        "path" in spilled
          ? `\n\n[Full output: ${spilled.path} (read with offset/limit)]`
          : `\n\n[Could not save the full output: ${spilled.error}]`;
      return {
        items: [{ text, type: "text" }, ...items.filter((item) => item.type === "image")],
        ...("path" in spilled ? { fullOutputPath: spilled.path } : {}),
      };
    }),
  );
}

function toScriptValue(
  tool: agentTypes.AgentTool<any>,
  outcome: agentTypes.AgentToolCallOutcome,
): unknown {
  const { result } = outcome;
  if (tool.outputSchema !== undefined && result.structuredContent !== undefined)
    return result.structuredContent;
  const text = textOf(result);
  if (outcome.isError) throw new Error(text || `Tool "${tool.name}" failed`);
  return text;
}

function executeCodemodeImpl(
  toolCallId: string,
  input: toolTypes.CodemodeToolInput,
  signal: AbortSignal | undefined,
  onUpdate:
    | ((result: agentTypes.AgentToolResult<toolTypes.CodemodeToolDetails>) => void)
    | undefined,
  ctx: extensionsTypesTypes.ExtensionToolContext | undefined,
  options: toolTypes.CodemodeToolOptions = {},
): Promise<agentTypes.AgentToolResult<toolTypes.CodemodeToolDetails>> {
  return Effect.runPromise(
    awaiting(function* () {
      const startedAt = performance.now();
      const { code, options: sourceOptions } = parseCodemodeSource(input.code);
      const calls: toolTypes.CodemodeNestedCall[] = [];

      let modelUsage: aiTypes.Usage | undefined;

      let generatedImages = 0;
      const addGeneratedImages = (count: number) => {
        generatedImages += count;
      };
      const addModelUsage = (usage: aiTypes.Usage) => {
        modelUsage = modelUsage === undefined ? usage : combineUsage(modelUsage, usage);
      };

      const snapshot = (): toolTypes.CodemodeToolDetails => ({
        calls: calls.map((call) => ({ ...call })),
      });
      const publish = () => onUpdate?.({ content: [], details: snapshot() });

      publish();

      const callable = ctx === undefined ? [] : getCodemodeCallableTools(ctx.tools);

      const guidelines = options.getToolGuidelines?.();
      const samples = new Map(
        callable.map((tool) => [
          tool.name,
          renderToolSample(toCodemodeDeclaration(tool, guidelines?.get(tool.name))),
        ]),
      );
      const sandboxTools: codemodeTypes.CodemodeTool[] = callable.map((tool) => {
        const description = samples.get(tool.name);
        return {
          name: tool.name,
          ...(description === undefined ? {} : { description }),
          execute: (args, { signal: callSignal }) =>
            Effect.runPromise(
              awaiting(function* () {
                const record: toolTypes.CodemodeNestedCall = {
                  args: previewArgs(args),
                  id: `${toolCallId}/?`,
                  name: tool.name,
                  status: "running",
                };
                calls.push(record);
                publish();
                const callStartedAt = performance.now();

                if (ctx === undefined) throw new Error("Tool calls need a session");
                const outcome = yield* awaited(
                  ctx.executeTool(tool.name, args, { signal: callSignal }),
                );
                record.id = outcome.toolCall.id;
                record.durationMs = performance.now() - callStartedAt;
                if (outcome.isError) {
                  record.status = callSignal.aborted ? "cancelled" : "error";
                  record.error = truncateText(
                    textOf(outcome.result) || `Tool "${tool.name}" failed`,
                    ERROR_PREVIEW_CHARS,
                  );
                } else {
                  record.status = "ok";
                }
                publish();
                return toScriptValue(tool, outcome);
              }),
            ),
        };
      });

      const workerUrl = getCodemodeWorkerSpecifier();
      const sandbox = new CodemodeSandbox({
        globals: [
          ...createDiscoveryGlobals(callable, samples, options),
          ...(options.models === true && ctx !== undefined
            ? createModelGlobals(
                ctx.modelRegistry,
                toolCallId,
                calls,
                publish,
                addModelUsage,
                addGeneratedImages,
              )
            : []),
        ],
        memoryLimitBytes: CODEMODE_MEMORY_LIMIT_BYTES,
        timeoutMs: sourceOptions.timeoutMs ?? Number.POSITIVE_INFINITY,
        tools: sandboxTools,
        wasm: codemode.loadQuickJSWasm(getQuickJSWasmPath()),
        ...(workerUrl === undefined ? {} : { workerUrl }),
        acquireWorker: () => {
          if (activeCodemodeWorkers >= MAX_CONCURRENT_CODEMODE_WORKERS) {
            throw new Error(
              `Codemode worker limit reached (${MAX_CONCURRENT_CODEMODE_WORKERS} workers are still running or shutting down). Retry after they exit.`,
            );
          }
          activeCodemodeWorkers++;
          return () => {
            activeCodemodeWorkers--;
          };
        },
      });

      let result: codemodeTypes.CodemodeResult;
      try {
        const store = ctx === undefined ? {} : readCodemodeStore(ctx.sessionManager.getBranch());
        result = yield* awaited(
          sandbox.execute(code, { ...(signal === undefined ? {} : { signal }), store }),
        );
      } finally {
        yield* awaited(sandbox.close());
      }

      for (const call of calls) {
        if (call.status === "running") call.status = "cancelled";
      }

      const scriptOutput = [...result.output];
      if (result.ok) {
        const { set, delete: deleted } = result.storeWrites;
        if (Object.keys(set).length > 0 || deleted.length > 0) {
          options.appendEntry?.(CODEMODE_STORE_ENTRY_TYPE, { delete: deleted, set });
        }

        if (result.value !== undefined)
          scriptOutput.push({ text: valueText(result.value), type: "text" });
      }
      const items = formatOutput(scriptOutput);
      if (!result.ok)
        items.push({ text: `Script error:\n${formatError(result, calls)}`, type: "text" });
      if (generatedImages > 0 && !items.some((item) => item.type === "image")) {
        items.push({
          text: `Note: models.generateImages() returned ${generatedImages} image${generatedImages === 1 ? "" : "s"} that the script did not show. Show each image block of result.output with image(block).`,
          type: "text",
        });
      }

      const truncated = yield* awaited(
        truncateOutput(
          joinAdjacentText(items),
          sourceOptions.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ),
      );

      const output = joinAdjacentText(yield* awaited(saveImages(truncated.items)));
      const wallTime = ((performance.now() - startedAt) / 1000).toFixed(1);
      const header = `${result.ok ? "Script completed" : "Script failed"}\nWall time ${wallTime} seconds\nOutput:\n`;
      const details = snapshot();
      if (truncated.fullOutputPath !== undefined && truncated.fullOutputPath !== "")
        details.fullOutputPath = truncated.fullOutputPath;
      return {
        content: [{ text: header, type: "text" }, ...output],
        details,
        ...(modelUsage === undefined ? {} : { usage: modelUsage }),
        ...(result.ok ? {} : { isError: true }),
      };
    }),
  );
}

const executeCodemode: {
  (
    toolCallId: string,
    input: toolTypes.CodemodeToolInput,
    signal: AbortSignal | undefined,
    onUpdate:
      | ((result: agentTypes.AgentToolResult<toolTypes.CodemodeToolDetails>) => void)
      | undefined,
    ctx: extensionsTypesTypes.ExtensionToolContext | undefined,
    options?: toolTypes.CodemodeToolOptions,
  ): Promise<agentTypes.AgentToolResult<toolTypes.CodemodeToolDetails>>;
  (
    input: toolTypes.CodemodeToolInput,
    signal: AbortSignal | undefined,
    onUpdate:
      | ((result: agentTypes.AgentToolResult<toolTypes.CodemodeToolDetails>) => void)
      | undefined,
    ctx: extensionsTypesTypes.ExtensionToolContext | undefined,
    options?: toolTypes.CodemodeToolOptions,
  ): (toolCallId: string) => Promise<agentTypes.AgentToolResult<toolTypes.CodemodeToolDetails>>;
} = dual((args: IArguments) => args.length >= 5, executeCodemodeImpl);

function isNamespaceName(namespace: extensionsTypesTypes.ToolNamespace, query: string): boolean {
  const queryId = toCodemodeIdentifier(query);
  return [namespace.name, ...(namespace.aliases ?? [])].some(
    (name) => name === query || toCodemodeIdentifier(name) === queryId,
  );
}

function createDiscoveryGlobals(
  tools: readonly agentTypes.AgentTool<any>[],
  samples: ReadonlyMap<string, string>,
  options: toolTypes.CodemodeToolOptions,
): codemodeTypes.CodemodeTool[] {
  const ranker = new Bm25Ranker();
  const entry = (name: string) => ({
    description: samples.get(name) ?? "",
    name: toCodemodeIdentifier(name),
  });
  return [
    {
      execute: (args) => searchTools(args, tools, options, ranker, entry),
      name: "searchTools",
      spread: true,
    },
    {
      execute: (args) => describeTool(args, tools, samples),
      name: "describeTool",
      spread: true,
    },
    {
      execute: (args) => {
        const [name] = args as unknown[];
        if (typeof name !== "string")
          throw new Error("describeNamespace() expects a namespace name");
        let namespace: extensionsTypesTypes.ToolNamespace | undefined;
        const names: string[] = [];
        for (const tool of tools) {
          const toolNamespace = options.getToolNamespace?.(tool.name);
          if (toolNamespace === undefined || !isNamespaceName(toolNamespace, name)) continue;
          namespace ??= toolNamespace;
          names.push(toCodemodeIdentifier(tool.name));
        }
        if (namespace === undefined) return undefined;
        return describeNamespace(namespace, names);
      },
      name: "describeNamespace",
      spread: true,
    },
  ];
}

function describeTool(
  args: unknown,
  tools: readonly agentTypes.AgentTool<any, any>[],
  samples: ReadonlyMap<string, string>,
) {
  const [name] = args as unknown[];
  if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
  const tool = tools.find(
    (candidate) => candidate.name === name || toCodemodeIdentifier(candidate.name) === name,
  );
  return tool === undefined ? undefined : samples.get(tool.name);
}

function describeNamespace(namespace: typesToolsTypes.ToolNamespace, names: string[]): unknown {
  return {
    name: namespace.name,
    ...(namespace.description !== undefined && namespace.description !== ""
      ? { description: namespace.description }
      : {}),
    ...(namespace.instructions !== undefined && namespace.instructions !== ""
      ? { instructions: namespace.instructions }
      : {}),
    tools: names,
  };
}

function searchTools(
  args: unknown,
  tools: readonly agentTypes.AgentTool<any, any>[],
  options: toolTypes.CodemodeToolOptions,
  ranker: Bm25Ranker,
  entry: (name: string) => { description: string; name: string },
) {
  const [query, searchOptions] = args as [
    unknown,
    { limit?: unknown; namespace?: unknown } | undefined,
  ];
  if (typeof query !== "string") throw new Error("searchTools() expects a query string");
  const limit = searchOptions?.limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
    throw new Error("searchTools() limit must be a positive integer");
  }
  const namespace = searchOptions?.namespace;
  if (namespace !== undefined && namespace !== null && typeof namespace !== "string") {
    throw new Error("searchTools() namespace must be a string");
  }
  const documents = tools.flatMap((tool) => {
    const toolNamespace = options.getToolNamespace?.(tool.name);
    if (
      namespace !== undefined &&
      namespace !== null &&
      namespace !== "" &&
      (toolNamespace === undefined || !isNamespaceName(toolNamespace, namespace))
    )
      return [];
    return [createToolSearchDocument(tool, toolNamespace)];
  });
  return ranker.rank(query, documents, limit).map((match) => entry(match.name));
}

function createModelGlobals(
  models: toolTypes.CodemodeModelRuntime,
  toolCallId: string,
  calls: toolTypes.CodemodeNestedCall[],
  publish: () => void,
  addUsage: (usage: aiTypes.Usage) => void,
  addGeneratedImages: (count: number) => void,
): codemodeTypes.CodemodeTool[] {
  const limit = createLimiter(MAX_CONCURRENT_MODEL_CALLS);
  let callCount = 0;

  const runModelCall = <
    TType extends "classifier" | "image",
    TContext,
    TResult extends ModelCallResult,
  >(
    name: string,
    type: TType,
    [model, context]: unknown[],
    checkContext: (context: unknown) => TContext,
    run: (resolved: aiTypes.ModelTypeMap[TType], context: TContext) => Promise<TResult>,
  ): Promise<TResult> =>
    Effect.runPromise(
      awaiting(function* () {
        const listHint = `List the ${type} models you can use with models.getAvailableOfType("${type}").`;
        const given = model as ScriptValue;
        const { provider, id } = modelReference(given, model, name, type, listHint);
        const ref = `${provider}/${id}`;
        const resolved = models.getModelOfType(type, provider, id);
        if (resolved === undefined) {
          const actualType = [...MODEL_TYPES].find(
            (other) =>
              other !== type &&
              models.getModelOfType(other as aiTypes.ModelType, provider, id) !== undefined,
          );
          throw new Error(
            actualType !== undefined && actualType !== ""
              ? `"${ref}" is ${withArticle(actualType)} model, not ${withArticle(type)} model. ${listHint}`
              : `Unknown ${type} model "${ref}". ${listHint}`,
          );
        }
        const checked = checkContext(context);

        const record: toolTypes.CodemodeNestedCall = {
          args: `${resolved.provider}/${resolved.id}`,
          id: `${toolCallId}/${name}/${++callCount}`,
          name,
          status: "running",
        };
        calls.push(record);
        publish();
        const startedAt = performance.now();
        const result = yield* awaited(limit(() => run(resolved, checked)));
        record.durationMs = performance.now() - startedAt;
        record.status =
          result.stopReason === "stop"
            ? "ok"
            : result.stopReason === "aborted"
              ? "cancelled"
              : "error";
        if (result.errorMessage !== undefined && result.errorMessage !== "")
          record.error = truncateText(result.errorMessage, ERROR_PREVIEW_CHARS);
        if (result.usage !== undefined) {
          record.cost = result.usage.cost.total;
          addUsage(result.usage);
        }
        publish();
        return result;
      }),
    );
  const implementations: Record<string, codemodeTypes.CodemodeTool["execute"]> = {
    "models.classify": (args, { signal }) =>
      runModelCall(
        "models.classify",
        "classifier",
        args as unknown[],
        checkClassifierContext,
        (resolved, context) => models.classify(resolved, context, { signal }),
      ),
    "models.generateImages": (args, { signal }) =>
      runModelCall(
        "models.generateImages",
        "image",
        args as unknown[],
        checkImagesContext,
        (resolved, context) =>
          Effect.runPromise(
            awaiting(function* () {
              const result = yield* awaited(models.generateImages(resolved, context, { signal }));
              addGeneratedImages(result.output.filter((block) => block.type === "image").length);
              return result;
            }),
          ),
      ),
    "models.getAvailableOfType": (args, { signal }) =>
      Effect.runPromise(
        awaiting(function* () {
          const [type, provider] = args as unknown[];
          const available = yield* awaited(
            models.getAvailableOfType(toModelType(type), toProvider(provider), {
              signal,
            }),
          );
          return available.map(toModelInfo);
        }),
      ),
    "models.getModelOfType": (args) => {
      const [type, provider, id] = args as unknown[];
      if (typeof provider !== "string" || typeof id !== "string") {
        throw new Error(
          `models.getModelOfType(type, provider, id) expects three strings, got (${(args as unknown[]).map(describeValue).join(", ")}). The provider and the id are separate arguments, for example models.getModelOfType("classifier", "openrouter", "~typesafe/jev-latest").`,
        );
      }
      const model = models.getModelOfType(toModelType(type), provider, id);
      return model === undefined ? undefined : toModelInfo(model);
    },
    "models.getModelsOfType": (args) => {
      const [type, provider] = args as unknown[];
      return models.getModelsOfType(toModelType(type), toProvider(provider)).map(toModelInfo);
    },
  };
  return Object.entries(implementations).map(([name, execute]) => ({
    execute,
    name,
    spread: true,
  }));
}

const execute = {
  executeCodemode,
  readCodemodeStore,
};

export default execute;

function modelReference(
  given: ScriptValue,
  model: unknown,
  name: string,
  type: string,
  listHint: string,
) {
  if (typeof given?.["provider"] !== "string" || typeof given["id"] !== "string") {
    const undefinedHint =
      model === undefined || model === null
        ? " models.getModelOfType() returns undefined for an unknown provider or id."
        : "";
    throw new Error(
      `${name}() expects ${withArticle(type)} model as its first argument, got ${describeValue(model)}.${undefinedHint} ${listHint}`,
    );
  }
  const provider = given["provider"];
  const id = given["id"];
  return { id, provider };
}
