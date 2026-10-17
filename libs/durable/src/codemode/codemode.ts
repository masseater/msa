import type { TextContent } from "@msa/ai";
import { type Context, copyJson, type JsonValue } from "@msa/chord";
import {
  type CodemodeHostCall,
  type CodemodeOutcome,
  type CodemodeResult,
  type CodemodeRun,
  type CodemodeSandboxBase,
  toCodemodeIdentifier,
} from "@msa/codemode/portable";
import { CODEMODE_SOURCE_GRAMMAR, parseCodemodeSource } from "@msa/codemode/source";
import { type Static, Type } from "typebox";

import { defineDoc } from "../documents.ts";
import type { ExecutionEnv } from "../env/index.ts";
import { errorMessage } from "../errors.ts";
import { defineExtension, defineTool, section } from "../harness/define.ts";
import { NestedCallDoc, type ToolTaskInput } from "../harness/tool.ts";
import type {
  Extension,
  NestedToolExecutionResult,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from "../harness/types.ts";
import { rankDocuments } from "../search.ts";
import type { JsonObject } from "../types.ts";
import {
  type CodemodeNamespace,
  codemodeDescription,
  codemodeSection,
  DEFAULT_CODEMODE_INLINE_BUDGET,
  namespaceOf,
  sampleOf,
} from "./describe.ts";
import {
  CATALOG_GLOBALS,
  CODEMODE_INTERNAL_PREFIX,
  catalogCall,
  createModelTools,
  GENERATE_IMAGES_TOOL,
  MAX_CONCURRENT_MODEL_CALLS,
  MODEL_CALLS,
} from "./models.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS, formatResult, type OutputFile } from "./output.ts";

export const CODEMODE_MODULE_VERSION = 2;

export const CODEMODE_TOOL_NAME = "codemode";

type DeclaredTool = {
  name: string;
  jsName: string;
  description: string;
  structured?: true;
  hidden?: true;
};

type Start = {
  version: number;
  startedAt: number;
  seed: number;
  fingerprint?: string;
  deadline?: number;
  tools: DeclaredTool[];
  namespaces: { name: string; description?: string; instructions?: string; tools: string[] }[];
  globals: { name: string; spread: boolean }[];
  maxOutputTokens: number;
  store: Record<string, JsonValue>;
};

type RunState = {
  start?: Start;
  outputDir?: string;
  result?: JsonObject;
};

export const CodemodeRunDoc = defineDoc<RunState>({
  kind: "msa.codemode.run",
  version: 1,
  scope: "task",
  initial: () => ({}),
});

type JournalEntry = {
  id: number;
  at: number;
  issuedAfter?: number;
  global?: { name: string; args?: JsonValue; outcome: JsonObject };
};

type JournalState = {
  entries: JournalEntry[];
  firstIssued?: number;
};

export const CodemodeJournalDoc = defineDoc<JournalState>({
  kind: "msa.codemode.journal",
  version: 1,
  scope: "task",
  initial: () => ({ entries: [] }),
});

export const CodemodeStoreDoc = defineDoc<{ values: Record<string, JsonValue> }>({
  kind: "msa.codemode.store",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ values: {} }),
});

export type CodemodeNestedCall = {
  id: number;
  name: string;
  args: string;
  status: "running" | "ok" | "error" | "cancelled";
  durationMs?: number;
  error?: string;
};

export type CodemodeToolDetails = {
  calls: CodemodeNestedCall[];
  fullOutputPath?: string;
};

const ARGS_PREVIEW_CHARS = 200;
const ERROR_PREVIEW_CHARS = 500;

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export type CodemodeGlobal = {
  readonly name: string;
  readonly spread?: boolean;
  execute(args: unknown, api: ToolExecutionApi, context: Context): Promise<JsonValue | undefined>;
};

const codemodeSchema = Type.Object({
  code: Type.String({ description: "Raw JavaScript source." }),
});

export type CodemodeToolInput = Static<typeof codemodeSchema>;

export type CodemodeToolOptions = {
  readonly sandbox: CodemodeSandboxBase;
  readonly namespaces?: readonly CodemodeNamespace[];
  readonly inlineBudget?: number;
  readonly models?: boolean;
  readonly globals?: readonly CodemodeGlobal[];
};

const OUTPUT_LIMITS = { maxBytes: 4 * 1024 * 1024, maxLines: 100_000 } as const;

const DISCOVERY_GLOBALS = ["searchTools", "describeTool", "describeNamespace"] as const;
const DEFAULT_SEARCH_LIMIT = 8;

export function createCodemodeTool(
  options: CodemodeToolOptions,
): ToolRegistration<typeof codemodeSchema> {
  return defineTool({
    name: CODEMODE_TOOL_NAME,
    description: codemodeDescription(options.models !== false),
    parameters: codemodeSchema,
    outputLimits: OUTPUT_LIMITS,
    constrainedSampling: { type: "grammar", variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR } },
    callers: ["model"],
    replay: "safe",
    execute: (args, api, context) => new CodemodeCall(options, api, context).execute(args.code),
  });
}

export function createCodemodeExtension(options: CodemodeToolOptions): Extension {
  return defineExtension({
    name: "codemode",
    tools: [createCodemodeTool(options), ...(options.models === false ? [] : createModelTools())],
    sections: [
      section("codemode", (input) =>
        codemodeSection(
          input.agent.callable.filter(
            (tool) => !tool.name.startsWith(CODEMODE_INTERNAL_PREFIX) && tool.deferred !== true,
          ),
          options.namespaces ?? [],
          options.inlineBudget ?? DEFAULT_CODEMODE_INLINE_BUDGET,
        ),
      ),
    ],
  });
}

function outcomeOf(
  name: string,
  structured: boolean,
  result: NestedToolExecutionResult,
): CodemodeOutcome {
  const value = structured ? result.structuredOutput : textOf(result.structuredOutput);
  if (!result.isError || (structured && value !== undefined)) return { ok: true, value };
  const message = structured ? "" : (value as string);
  const diagnostics = result.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.message)
    .join("\n");
  return {
    ok: false,
    message: message || diagnostics || `Tool ${name} failed`,
    ...(value === undefined ? {} : { properties: { structuredOutput: value } }),
  };
}

function textOf(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((item) => (isText(item) ? [item.text] : [])).join("\n");
}

function isText(item: unknown): item is TextContent {
  return typeof item === "object" && item !== null && (item as TextContent).type === "text";
}

function errorResult(message: string): ToolExecutionResult {
  return { output: [{ type: "text", text: message }], isError: true };
}

class CodemodeCall {
  private readonly options: CodemodeToolOptions;
  private readonly api: ToolExecutionApi;
  private readonly context: Context;
  private readonly controller = new AbortController();
  private run!: CodemodeRun;
  private start!: Start;
  private replayed: JournalEntry[] = [];
  private journalLength = 0;
  private nextReplayed = 0;
  private replaying = false;
  private rerun = false;
  private released = false;
  private firstIssued: number | undefined;
  private durableIssued = 0;
  private waiting: CodemodeHostCall[] = [];
  private replayIndex = new Map<number, number>();
  private issued = 0;
  private readonly ready = new Map<number, CodemodeOutcome>();
  private held: CodemodeHostCall[] = [];
  private queue: {
    id: number;
    at: number;
    outcome: CodemodeOutcome;
    global?: JournalEntry["global"];
  }[] = [];
  private readonly acks = new Map<number, number>();
  private committing = false;
  private ended: ToolExecutionResult | undefined;
  private failure: unknown;
  private modelCalls = 0;
  private readonly modelWaiters: (() => void)[] = [];
  private generatedImages = 0;
  private readonly rows = new Map<number, CodemodeNestedCall>();
  private gate!: Promise<void>;
  private openGate!: () => void;

  constructor(options: CodemodeToolOptions, api: ToolExecutionApi, context: Context) {
    this.options = options;
    this.api = api;
    this.context = context;
    this.gate = new Promise((resolve) => {
      this.openGate = resolve;
    });
  }

  async execute(source: string): Promise<ToolExecutionResult> {
    const { code, options: sourceOptions } = parseCodemodeSource(source);
    const { api, context } = this;
    const agent = await api.agent(context);
    const tools: DeclaredTool[] = agent.callable.map((tool) => ({
      name: tool.name,
      jsName: toCodemodeIdentifier(tool.name),
      description: sampleOf(tool),
      ...(tool.structuredOutputSchema === undefined ? {} : { structured: true as const }),
      ...(tool.name.startsWith(CODEMODE_INTERNAL_PREFIX) ? { hidden: true as const } : {}),
    }));
    const callable = agent.callable.filter(
      (tool) => !tool.name.startsWith(CODEMODE_INTERNAL_PREFIX),
    );
    const models =
      this.options.models === false ? [] : [...CATALOG_GLOBALS, ...Object.keys(MODEL_CALLS)];
    const globals = [
      ...DISCOVERY_GLOBALS.map((name) => ({ name, spread: true })),
      ...models.map((name) => ({ name, spread: true })),
      ...(this.options.globals ?? []).map((global) => ({
        name: global.name,
        spread: global.spread === true,
      })),
    ];
    const namespaces: Start["namespaces"] = [];
    for (const tool of callable) {
      const namespace = namespaceOf(tool.name, this.options.namespaces ?? []);
      if (namespace === undefined) continue;
      let entry = namespaces.find((candidate) => candidate.name === namespace.name);
      if (entry === undefined) {
        entry = {
          name: namespace.name,
          ...(namespace.description === undefined ? {} : { description: namespace.description }),
          ...(namespace.instructions === undefined ? {} : { instructions: namespace.instructions }),
          tools: [],
        };
        namespaces.push(entry);
      }
      entry.tools.push(tool.name);
    }
    const now = Date.now();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    type Found =
      | { done: ToolExecutionResult }
      | { start: Start; journal: JournalEntry[]; firstIssued: number | undefined; rerun: boolean };
    const found = await api.commit(async (tx): Promise<Found> => {
      const run = await tx.doc(CodemodeRunDoc, api.taskId);
      if (run.result !== undefined)
        return { done: copyJson(run.result as JsonValue) as ToolExecutionResult };
      const rerun = run.start !== undefined;
      if (run.start === undefined) {
        const store = await tx.doc(CodemodeStoreDoc, api.conversationId);
        const timeout = sourceOptions.timeoutMs;
        run.start = {
          version: CODEMODE_MODULE_VERSION,
          startedAt: now,
          seed,
          ...(timeout === undefined ? {} : { deadline: now + timeout }),
          tools,
          namespaces,
          globals,
          maxOutputTokens: sourceOptions.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          store: copyJson(store.values as JsonValue) as Record<string, JsonValue>,
        };
      }
      const journal = await tx.doc(CodemodeJournalDoc, api.taskId);
      return {
        start: copyJson(run.start as unknown as JsonValue) as unknown as Start,
        journal: copyJson(journal.entries as unknown as JsonValue) as unknown as JournalEntry[],
        firstIssued: journal.firstIssued,
        rerun,
      };
    }, context);
    if ("done" in found) return found.done;
    this.start = found.start;
    this.replayed = found.journal;
    this.replayIndex = new Map(found.journal.map((entry, index) => [entry.id, index]));
    this.journalLength = found.journal.length;
    this.replaying = found.journal.length > 0;
    this.rerun = found.rerun;
    this.firstIssued = found.firstIssued;
    this.durableIssued = found.journal.reduce(
      (max, entry) => Math.max(max, entry.issuedAfter ?? 0),
      found.firstIssued ?? 0,
    );

    if (this.start.version !== CODEMODE_MODULE_VERSION) {
      return this.decide(
        errorResult(
          `The script cannot resume: it started under code mode version ${this.start.version}, this is ${CODEMODE_MODULE_VERSION}.`,
        ),
      );
    }
    const remaining =
      this.start.deadline === undefined ? undefined : this.start.deadline - Date.now();
    if (remaining !== undefined && remaining <= 0) {
      return this.decide(
        errorResult(`Script timed out: its deadline passed while it was interrupted.`),
      );
    }

    const onAbort = () => this.controller.abort(context.abortSignal?.reason);
    context.abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (context.abortSignal?.aborted) onAbort();
    try {
      this.run = this.options.sandbox.start(code, {
        startedAt: this.start.startedAt,
        seed: this.start.seed,
        tools: this.start.tools.filter((tool) => tool.hidden !== true),
        globals: this.start.globals,
        store: this.start.store,
        signal: this.controller.signal,
        ...(remaining === undefined ? {} : { timeoutMs: remaining }),
        onStarted: (fingerprint) => void this.checkFingerprint(fingerprint),
        onCall: (call) => this.onCall(call),
        onIdle: (seq, issued) => this.onIdle(seq, issued),
      });
      const result = await this.run.result;
      if (this.failure !== undefined) throw this.failure;
      if (this.ended !== undefined) return this.ended;
      context.abortSignal?.throwIfAborted();
      if (!result.ok && result.error.kind === "aborted" && !this.controller.signal.aborted) {
        await new Promise<void>((resolve) => {
          if (context.abortSignal === undefined || context.abortSignal.aborted) resolve();
          else context.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        context.abortSignal?.throwIfAborted();
        throw new Error("The code mode sandbox was closed while the script ran");
      }
      const during = result.during;
      if (this.rerun && during !== undefined && during.seq <= this.replayed.length) {
        const continued =
          (during.seq === 0
            ? this.replayed.length > 0 || this.firstIssued !== undefined
            : this.replayed[during.seq - 1]?.issuedAfter !== undefined) ||
          this.replayed.slice(during.seq).some((entry) => entry.id > during.issued);
        if (continued) {
          return this.decide(
            errorResult(
              `The script took a different path when resumed after a restart: it ended after result ${during.seq}, where it went on before.`,
            ),
          );
        }
      }
      return this.complete(result);
    } finally {
      context.abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  private async decide(decided: ToolExecutionResult): Promise<ToolExecutionResult> {
    const result = { ...decided, details: this.details() as unknown as JsonValue };
    await this.api.commit(async (tx) => {
      const run = await tx.doc(CodemodeRunDoc, this.api.taskId);
      run.result ??= copyJson(result as unknown as JsonValue, {
        omitUndefinedProperties: true,
      }) as JsonObject;
    }, this.context);
    return result;
  }

  private diverge(message: string): void {
    if (this.ended !== undefined || this.failure !== undefined) return;
    const result = errorResult(
      `The script took a different path when resumed after a restart: ${message}`,
    );
    this.ended = result;
    this.decide(result).then(
      () => this.controller.abort(new Error(message)),
      (error: unknown) => this.fail(error),
    );
  }

  private get stopped(): boolean {
    return this.ended !== undefined || this.failure !== undefined || this.run?.finished === true;
  }

  private fail(error: unknown): void {
    if (this.failure !== undefined) return;
    this.failure = error;
    this.controller.abort(error);
  }

  private async complete(result: CodemodeResult): Promise<ToolExecutionResult> {
    const details = this.details();
    const formatted = await formatResult(result, {
      generatedImages: this.generatedImages,
      wallMs: Date.now() - this.start.startedAt,
      maxOutputTokens: this.start.maxOutputTokens,
      calls: details.calls,
      limits: OUTPUT_LIMITS,
      write: this.outputFiles(),
    });
    const tool: ToolExecutionResult = {
      output: formatted.content,
      isError: !result.ok,
      details: {
        ...details,
        ...(formatted.fullOutputPath === undefined
          ? {}
          : { fullOutputPath: formatted.fullOutputPath }),
      } as unknown as JsonValue,
    };
    const writes = result.ok ? result.storeWrites : undefined;
    return this.api.commit(async (tx) => {
      const run = await tx.doc(CodemodeRunDoc, this.api.taskId);
      if (run.result !== undefined) return run.result as ToolExecutionResult;
      run.result = copyJson(tool as unknown as JsonValue, {
        omitUndefinedProperties: true,
      }) as JsonObject;
      if (
        writes !== undefined &&
        (Object.keys(writes.set).length > 0 || writes.delete.length > 0)
      ) {
        const store = await tx.doc(CodemodeStoreDoc, this.api.conversationId);
        for (const key of writes.delete) delete store.values[key];
        for (const [key, value] of Object.entries(writes.set))
          store.values[key] = value as JsonValue;
      }
      return tool;
    }, this.context);
  }

  private outputFiles(): OutputFile {
    const env = this.api.env;
    let directory: Promise<string> | undefined;
    return async (name, data) => {
      if (env === undefined) return { error: "no execution environment" };
      try {
        directory ??= this.outputDir(env);
        const path = `${await directory}/${name}`;
        const written = await env.writeFile(path, data, this.context);
        return written.ok ? { path } : { error: written.error.message };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    };
  }

  private async outputDir(env: ExecutionEnv): Promise<string> {
    const recorded = await this.api.commit(
      async (tx) => (await tx.doc(CodemodeRunDoc, this.api.taskId)).outputDir,
      this.context,
    );
    if (recorded !== undefined) return recorded;
    const created = await env.createTempDir("msa-codemode-", this.context);
    if (!created.ok) throw new Error(created.error.message);
    return this.api.commit(async (tx) => {
      const run = await tx.doc(CodemodeRunDoc, this.api.taskId);
      run.outputDir ??= created.value;
      return run.outputDir!;
    }, this.context);
  }

  private async checkFingerprint(fingerprint: string): Promise<void> {
    const recorded = this.start.fingerprint;
    if (recorded === undefined) {
      try {
        await this.api.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, this.api.taskId);
          if (run.start !== undefined) run.start.fingerprint = fingerprint;
        }, this.context);
      } catch (error) {
        this.fail(error);
        return;
      }
    } else if (recorded !== fingerprint) {
      this.ended = errorResult(
        `The script cannot resume: the sandbox changed since it started (${recorded} -> ${fingerprint}).`,
      );
      await this.decide(this.ended).catch((error: unknown) => this.fail(error));
      this.controller.abort(new Error("Sandbox fingerprint changed"));
      return;
    }
    this.openGate();
    if (this.replaying) this.deliverReplayed();
    else if (!this.rerun) void this.release();
  }

  private onCall(made: CodemodeHostCall): void {
    if (this.stopped) return;
    const call = asToolCall(made);
    if (call.target === "tool") this.started(call);
    this.issued = Math.max(this.issued, call.id);
    const index = this.replaying ? (this.replayIndex.get(call.id) ?? -1) : -1;
    if (index === -1) {
      if (this.released) {
        this.waiting.push(call);
        this.launchCovered();
      } else this.held.push(call);
      return;
    }
    const entry = this.replayed[index]!;
    if (entry.global !== undefined) {
      if (
        call.target !== "global" ||
        call.name !== entry.global.name ||
        !sameJson(call.args, entry.global.args)
      ) {
        this.diverge(
          `call ${call.id} is ${describe(call)}, but was a call to ${entry.global.name}`,
        );
        return;
      }
      this.ready.set(call.id, entry.global.outcome as CodemodeOutcome);
      void this.gate.then(() => this.deliverReplayed());
      return;
    }
    if (call.target !== "tool") {
      this.diverge(`call ${call.id} is ${describe(call)}, but was a tool call`);
      return;
    }
    void this.gate
      .then(() => this.callTool(call))
      .then(
        (outcome) => {
          this.ready.set(call.id, outcome);
          this.deliverReplayed();
        },
        (error: unknown) => {
          if (this.stopped) return;
          if (this.context.abortSignal?.aborted) this.fail(error);
          else this.diverge(`call ${call.id} is ${describe(call)}: ${errorMessage(error)}`);
        },
      );
  }

  private deliverReplayed(): void {
    while (this.nextReplayed < this.replayed.length && !this.stopped) {
      const entry = this.replayed[this.nextReplayed]!;
      const outcome = this.ready.get(entry.id);
      if (entry.id > this.issued || outcome === undefined) return;
      this.ready.delete(entry.id);
      this.nextReplayed++;
      this.run.deliver(this.nextReplayed, entry.at, entry.id, outcome);
    }
  }

  private onIdle(seq: number, issued: number): void {
    if (this.stopped) return;
    if (this.rerun && seq <= this.replayed.length) {
      const recorded = seq === 0 ? this.firstIssued : this.replayed[seq - 1]!.issuedAfter;
      if (recorded !== undefined && recorded !== issued) {
        this.diverge(
          seq === 0
            ? `its first run made ${issued} calls, where it had made ${recorded}`
            : `after result ${seq} it had made ${issued} calls, where it had made ${recorded}`,
        );
        return;
      }
    }
    this.acks.set(seq, issued);
    if (!this.replaying) {
      if (seq === 0 && this.rerun) void this.release();
      if (seq === this.journalLength) void this.pump();
      return;
    }
    if (seq !== this.nextReplayed) return;
    const next = this.replayed[seq];
    if (next !== undefined) {
      if (next.id > issued)
        this.diverge(`it waits without making call ${next.id}, which it made before`);
      return;
    }
    this.replaying = false;
    void this.pump();
    void this.release();
  }

  private async release(): Promise<void> {
    await this.gate;
    if (this.stopped || this.released) return;
    const calls = this.held.splice(0);
    if (this.rerun) {
      for await (const call of calls) {
        let other: string | undefined;
        try {
          other = await this.earlier(call);
        } catch (error) {
          this.fail(error);
          return;
        }
        if (this.stopped) return;
        if (other !== undefined) {
          this.diverge(`call ${call.id} is ${describe(call)}, but was ${other}`);
          return;
        }
      }
    }
    this.released = true;
    this.waiting.push(...calls, ...this.held.splice(0));
    this.launchCovered();
  }

  private launchCovered(): void {
    if (!this.released || this.stopped) return;
    const covered = this.waiting.filter((call) => call.id <= this.durableIssued);
    if (covered.length === 0) return;
    this.waiting = this.waiting.filter((call) => call.id > this.durableIssued);
    for (const call of covered) this.launch(call);
  }

  private async earlier(call: CodemodeHostCall): Promise<string | undefined> {
    const { api, context } = this;
    const taskId = (await api.snapshot(NestedCallDoc, api.taskId, `c${call.id}`, context))?.taskId;
    if (taskId === undefined) return undefined;
    const input = (await api.getTask(taskId, context))?.input as ToolTaskInput | undefined;
    if (input?.kind !== "nested") return undefined;
    const made = input.call;
    if (
      call.target === "tool" &&
      made.name === call.name &&
      sameJson(made.arguments, call.args ?? {})
    )
      return undefined;
    return `tools.${made.name}(${JSON.stringify(made.arguments)})`;
  }

  private launch(call: CodemodeHostCall): void {
    if (this.stopped) return;
    const running: Promise<{ outcome: CodemodeOutcome; global?: JournalEntry["global"] }> =
      call.target === "tool"
        ? this.callTool(call).then((outcome) => ({ outcome }))
        : this.callGlobal(call).then((outcome) => ({
            outcome,
            global: {
              name: call.name,
              ...(call.args === undefined ? {} : { args: call.args as JsonValue }),
              outcome: outcome as JsonObject,
            },
          }));
    running.then(
      (done) => {
        this.queue.push({ id: call.id, at: Date.now(), ...done });
        void this.pump();
      },
      (error: unknown) => {
        if (this.stopped) return;
        if (this.context.abortSignal?.aborted) this.fail(error);
        else this.diverge(`call ${call.id} is ${describe(call)}: ${errorMessage(error)}`);
      },
    );
  }

  private async callTool(call: CodemodeHostCall): Promise<CodemodeOutcome> {
    const args = (call.args ?? {}) as JsonObject;
    const model = call.name.startsWith(CODEMODE_INTERNAL_PREFIX);
    if (model) {
      await this.modelSlot();
      if (this.stopped) {
        this.releaseModelSlot();
        throw new Error("The script has ended");
      }
    }
    let result: NestedToolExecutionResult;
    try {
      result = await this.api.executeTool(call.name, args, this.context, { key: `c${call.id}` });
    } finally {
      if (model) this.releaseModelSlot();
    }
    if (call.name === GENERATE_IMAGES_TOOL)
      this.generatedImages += countImages(result.structuredOutput);
    const structured =
      this.start.tools.find((tool) => tool.name === call.name)?.structured === true;
    const outcome = outcomeOf(call.name, structured, result);
    this.finishRow(call.id, outcome, result);
    return outcome;
  }

  private started(call: CodemodeHostCall): void {
    if (this.rows.has(call.id)) return;
    const args = call.args === undefined ? "" : (JSON.stringify(call.args) ?? "");
    const name = call.name.startsWith(CODEMODE_INTERNAL_PREFIX)
      ? call.name.slice(CODEMODE_INTERNAL_PREFIX.length)
      : call.name;
    this.rows.set(call.id, {
      id: call.id,
      name,
      args: cut(args, ARGS_PREVIEW_CHARS),
      status: "running",
    });
  }

  private finishRow(id: number, outcome: CodemodeOutcome, result: NestedToolExecutionResult): void {
    const row = this.rows.get(id);
    if (row === undefined) return;
    row.status = result.isError ? "error" : "ok";
    if (result.durationMs !== undefined) row.durationMs = result.durationMs;
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const error = outcome.ok
      ? errors.map((diagnostic) => diagnostic.message).join("\n")
      : outcome.message;
    if (result.isError && error !== "") row.error = cut(error, ERROR_PREVIEW_CHARS);
  }

  private details(): CodemodeToolDetails {
    const calls = [...this.rows.values()]
      .sort((a, b) => a.id - b.id)
      .map((row) =>
        row.status === "running" ? Object.assign({}, row, { status: "cancelled" as const }) : row,
      );
    return { calls };
  }

  private async callGlobal(call: CodemodeHostCall): Promise<CodemodeOutcome> {
    const discovery = (DISCOVERY_GLOBALS as readonly string[]).includes(call.name);
    const catalog = (CATALOG_GLOBALS as readonly string[]).includes(call.name);
    const global =
      discovery || catalog
        ? undefined
        : this.options.globals?.find((candidate) => candidate.name === call.name);
    if (!discovery && !catalog && global === undefined)
      return { ok: false, message: `Unknown global ${call.name}` };
    try {
      const value = discovery
        ? this.discover(call)
        : catalog
          ? await catalogCall(call.name, call.args, this.api.models, this.context)
          : await global!.execute(call.args, this.api, this.context);
      return { ok: true, value };
    } catch (error) {
      if (this.context.abortSignal?.aborted) throw error;
      return { ok: false, message: errorMessage(error) };
    }
  }

  private async modelSlot(): Promise<void> {
    if (this.modelCalls >= MAX_CONCURRENT_MODEL_CALLS) {
      await new Promise<void>((resolve) => {
        this.modelWaiters.push(resolve);
      });
    }
    this.modelCalls++;
  }

  private releaseModelSlot(): void {
    this.modelCalls--;
    this.modelWaiters.shift()?.();
  }

  private discover(call: CodemodeHostCall): JsonValue | undefined {
    const args = Array.isArray(call.args) ? call.args : [];
    const { namespaces } = this.start;
    const tools = this.start.tools.filter((tool) => tool.hidden !== true);
    const namespaceOfTool = (name: string) =>
      namespaces.find((namespace) => namespace.tools.includes(name));
    const matchesNamespace = (namespace: Start["namespaces"][number], query: string) =>
      namespace.name === query ||
      toCodemodeIdentifier(namespace.name) === toCodemodeIdentifier(query);
    if (call.name === "describeTool") {
      const [name] = args;
      if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
      return tools.find((tool) => tool.name === name || tool.jsName === name)?.description;
    }
    if (call.name === "describeNamespace") {
      const [name] = args;
      if (typeof name !== "string") throw new Error("describeNamespace() expects a namespace name");
      const namespace = namespaces.find((candidate) => matchesNamespace(candidate, name));
      if (namespace === undefined) return undefined;
      return {
        name: namespace.name,
        ...(namespace.description === undefined ? {} : { description: namespace.description }),
        ...(namespace.instructions === undefined ? {} : { instructions: namespace.instructions }),
        tools: namespace.tools.map((tool) => toCodemodeIdentifier(tool)),
      };
    }
    const [query, options] = args as [
      unknown,
      { limit?: unknown; namespace?: unknown } | undefined,
    ];
    if (typeof query !== "string") throw new Error("searchTools() expects a query string");
    const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      throw new Error("searchTools() limit must be a positive integer");
    }
    const namespace = options?.namespace;
    if (namespace !== undefined && namespace !== null && typeof namespace !== "string") {
      throw new Error("searchTools() namespace must be a string");
    }
    const documents = tools.flatMap((tool) => {
      const own = namespaceOfTool(tool.name);
      if (typeof namespace === "string" && (own === undefined || !matchesNamespace(own, namespace)))
        return [];
      const text = [
        tool.name,
        tool.name.replaceAll("_", " "),
        tool.description,
        own?.name ?? "",
        own?.description ?? "",
      ];
      return [{ name: tool.name, text: text.join(" ") }];
    });
    return rankDocuments(query, documents, limit).map((name) => {
      const tool = tools.find((candidate) => candidate.name === name)!;
      return { name: tool.jsName, description: tool.description };
    });
  }

  private async pump(): Promise<void> {
    if (this.committing || this.stopped) return;
    if (this.queue.length === 0 && this.acks.size === 0) return;
    this.committing = true;
    const batch = this.queue.splice(0);
    const acks = [...this.acks];
    this.acks.clear();
    try {
      await this.api.commit(async (tx) => {
        const journal = await tx.doc(CodemodeJournalDoc, this.api.taskId);
        for (const [seq, issued] of acks) {
          if (seq === 0) journal.firstIssued ??= issued;
          else {
            const entry = journal.entries[seq - 1];
            if (entry !== undefined && entry.issuedAfter === undefined) entry.issuedAfter = issued;
          }
        }
        for (const item of batch) {
          const entry = {
            id: item.id,
            at: item.at,
            ...(item.global === undefined ? {} : { global: item.global }),
          };
          journal.entries.push(
            copyJson(entry as unknown as JsonValue, {
              omitUndefinedProperties: true,
            }) as unknown as JournalEntry,
          );
        }
      }, this.context);
    } catch (error) {
      this.fail(error);
      return;
    }
    for (const [, issued] of acks) this.durableIssued = Math.max(this.durableIssued, issued);
    for (const item of batch) {
      this.journalLength++;
      if (!this.run.finished) this.run.deliver(this.journalLength, item.at, item.id, item.outcome);
    }
    this.launchCovered();
    this.committing = false;
    void this.pump();
  }
}

function asToolCall(call: CodemodeHostCall): CodemodeHostCall {
  const tool = call.target === "global" ? MODEL_CALLS[call.name] : undefined;
  if (tool === undefined) return call;
  const [model, context] = Array.isArray(call.args) ? call.args : [];
  return {
    id: call.id,
    target: "tool",
    name: tool,
    args: { model: model ?? null, context: context ?? null },
  };
}

function countImages(value: unknown): number {
  const output =
    typeof value === "object" && value !== null
      ? (value as { output?: unknown }).output
      : undefined;
  return Array.isArray(output)
    ? output.filter((item) => (item as { type?: unknown })?.type === "image").length
    : 0;
}

function describe(call: CodemodeHostCall): string {
  return `${call.target === "tool" ? "tools." : ""}${call.name}(${JSON.stringify(call.args) ?? ""})`;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}
