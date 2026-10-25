import { Effect, Option } from "effect";
import type OpenAI from "openai";

import type typesModule from "../types.types.ts";
import openaiCompletionsCompat from "./openai-completions-compat.ts";
import type openaiCompletionsCompatTypes from "./openai-completions-compat.types.ts";

const { isKnownHostedEndpoint } = openaiCompletionsCompat;

type Compat = openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat;

const OLLAMA_ROOT_TEXT = "Ollama is running";
const PROBE_TIMEOUT_MS = 2000;

const UNSETTLED_STATUSES = new Set([401, 403, 407, 408, 429]);

type ProbeAnswer = boolean | undefined;

const ollamaRoots = new Map<string, Promise<ProbeAnswer>>();

function serverRoot(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "").replace(/\/v1$/u, "")}/`;
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
    Effect.map(Option.match({ onNone: () => false, onSome: isOllamaRoot })),
    Effect.catch((failure) => Effect.succeed(settledByStatus(failure.cause) ? false : undefined)),
  );

function keepSettled(root: string, answer: ProbeAnswer): ProbeAnswer {
  if (answer === undefined) ollamaRoots.delete(root);
  return answer;
}

function sharedProbe(client: OpenAI, root: string): Promise<ProbeAnswer> {
  const known = ollamaRoots.get(root);
  if (known !== undefined) return known;
  const pending = Effect.runPromise(askRoot(client, root)).then(
    (answer) => keepSettled(root, answer),
    () => keepSettled(root, undefined),
  );
  ollamaRoots.set(root, pending);
  return pending;
}

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
  const answer = Effect.promise(() => sharedProbe(client, root));
  const raced = signal === undefined ? answer : Effect.raceFirst(answer, aborted(signal));
  return raced.pipe(Effect.map((isOllama) => isOllama === true));
};

interface ResolveMaxTokensFieldInput {
  readonly client: OpenAI;
  readonly compat: Compat;
  readonly model: typesModule.Model<"openai-completions">;
  readonly signal: AbortSignal | undefined;
}

function resolveMaxTokensField(input: ResolveMaxTokensFieldInput): Effect.Effect<Compat> {
  const { client, compat, model, signal } = input;
  if (
    compat.maxTokensField === "max_tokens" ||
    model.compat?.maxTokensField !== undefined ||
    isKnownHostedEndpoint(model)
  ) {
    return Effect.succeed(compat);
  }
  return Effect.gen(function* () {
    const isOllama = yield* probeOllama(client, serverRoot(model.baseUrl), signal);
    if (!isOllama) return compat;
    const ollamaCompat: Compat = { ...compat, maxTokensField: "max_tokens" };
    return ollamaCompat;
  });
}

const openaiCompletionsOllama = {
  resolveMaxTokensField,
};

export default openaiCompletionsOllama;
