import { Clock, Effect, Option } from "effect";
import type OpenAI from "openai";

import type typesModule from "../types.types.ts";
import openaiCompletionsCompat from "./openai-completions-compat.ts";
import type openaiCompletionsCompatTypes from "./openai-completions-compat.types.ts";

const { isKnownHostedEndpoint } = openaiCompletionsCompat;

type Compat = openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat;
type CompletionsModel = typesModule.Model<"openai-completions">;

const OLLAMA_ROOT_TEXT = "Ollama is running";
const OLLAMA_FINGERPRINT = "fp_ollama";
const PROBE_TIMEOUT_MS = 2000;
const PROBE_RETRY_MS = 60_000;

const UNSETTLED_STATUSES = new Set([401, 403, 407, 408, 429]);

type ProbeAnswer = boolean | undefined;

interface RootMemory {
  answer: ProbeAnswer;
  probe: Promise<ProbeAnswer> | undefined;
  retryAt: number;
}

const roots = new Map<string, RootMemory>();

function serverRoot(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "").replace(/\/v1$/u, "")}/`;
}

function memoryOf(root: string): RootMemory {
  const known = roots.get(root);
  if (known !== undefined) return known;
  const memory: RootMemory = { answer: undefined, probe: undefined, retryAt: 0 };
  roots.set(root, memory);
  return memory;
}

function mayBeOllama(model: CompletionsModel, compat: Compat): boolean {
  return (
    compat.maxTokensField !== "max_tokens" &&
    model.compat?.maxTokensField === undefined &&
    !isKnownHostedEndpoint(model)
  );
}

function settledByStatus(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status } = error as { status?: unknown };
  return typeof status === "number" && status < 500 && !UNSETTLED_STATUSES.has(status);
}

const isOllamaRoot = (body: unknown): boolean =>
  typeof body === "string" && body.trim() === OLLAMA_ROOT_TEXT;

const askRoot = (client: OpenAI, root: string): Effect.Effect<ProbeAnswer> =>
  Effect.tryPromise((signal) => client.get<unknown>(root, { maxRetries: 0, signal })).pipe(
    Effect.timeoutOption(PROBE_TIMEOUT_MS),
    Effect.map(Option.match({ onNone: (): ProbeAnswer => undefined, onSome: isOllamaRoot })),
    Effect.catch((failure) => Effect.succeed(settledByStatus(failure.cause) ? false : undefined)),
  );

const settle = (memory: RootMemory, answer: ProbeAnswer): Effect.Effect<ProbeAnswer> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    memory.probe = undefined;
    if (memory.answer !== undefined) return memory.answer;
    if (answer === undefined) memory.retryAt = now + PROBE_RETRY_MS;
    memory.answer = answer;
    return answer;
  });

const startProbe = (client: OpenAI, root: string, memory: RootMemory): Promise<ProbeAnswer> => {
  const probe = Effect.runPromise(
    askRoot(client, root).pipe(Effect.flatMap((answer) => settle(memory, answer))),
  );
  memory.probe = probe;
  return probe;
};

const sharedAnswer = (client: OpenAI, root: string): Effect.Effect<ProbeAnswer> =>
  Effect.gen(function* () {
    const memory = memoryOf(root);
    if (memory.answer !== undefined) return memory.answer;
    const running = memory.probe;
    if (running !== undefined) return yield* Effect.promise(() => running);
    if ((yield* Clock.currentTimeMillis) < memory.retryAt) return undefined;
    return yield* Effect.promise(() => startProbe(client, root, memory));
  });

const aborted = (signal: AbortSignal): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    const stop = () => resume(Effect.succeed(false));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", stop));
  });

const probeOllama = (
  client: OpenAI,
  root: string,
  signal: AbortSignal | undefined,
): Effect.Effect<boolean> => {
  const answer = sharedAnswer(client, root).pipe(Effect.map((isOllama) => isOllama === true));
  return signal === undefined ? answer : Effect.raceFirst(answer, aborted(signal));
};

interface ResolveMaxTokensFieldInput {
  readonly client: OpenAI;
  readonly compat: Compat;
  readonly model: CompletionsModel;
  readonly signal: AbortSignal | undefined;
}

function resolveMaxTokensField(input: ResolveMaxTokensFieldInput): Effect.Effect<Compat> {
  const { client, compat, model, signal } = input;
  if (!mayBeOllama(model, compat)) return Effect.succeed(compat);
  return Effect.gen(function* () {
    const isOllama = yield* probeOllama(client, serverRoot(model.baseUrl), signal);
    if (!isOllama) return compat;
    const ollamaCompat: Compat = { ...compat, maxTokensField: "max_tokens" };
    return ollamaCompat;
  });
}

interface LearnFromChunkInput {
  readonly chunk: unknown;
  readonly compat: Compat;
  readonly model: CompletionsModel;
}

function learnFromChunk(input: LearnFromChunkInput): void {
  const { chunk, compat, model } = input;
  if (typeof chunk !== "object" || chunk === null || !mayBeOllama(model, compat)) return;
  const { system_fingerprint: fingerprint } = chunk as { system_fingerprint?: unknown };
  memoryOf(serverRoot(model.baseUrl)).answer = fingerprint === OLLAMA_FINGERPRINT;
}

const openaiCompletionsOllama = {
  learnFromChunk,
  resolveMaxTokensField,
};

export default openaiCompletionsOllama;
