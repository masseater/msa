import { Effect, Option } from "effect";
import type OpenAI from "openai";

import type typesModule from "../types.types.ts";
import openaiCompletionsCompat from "./openai-completions-compat.ts";
import type openaiCompletionsCompatTypes from "./openai-completions-compat.types.ts";

const { isKnownHostedEndpoint } = openaiCompletionsCompat;

type Compat = openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat;

const OLLAMA_ROOT_TEXT = "Ollama is running";
const PROBE_TIMEOUT_MS = 2000;

const ollamaRoots = new Map<string, boolean>();

function serverRoot(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "").replace(/\/v1$/u, "")}/`;
}

function serverAnswered(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status } = error as { status?: unknown };
  return typeof status === "number";
}

const isOllamaRoot = (body: unknown): boolean =>
  typeof body === "string" && body.trim() === OLLAMA_ROOT_TEXT;

const probeOllama = (
  client: OpenAI,
  root: string,
  signal: AbortSignal | undefined,
): Effect.Effect<boolean> => {
  const known = ollamaRoots.get(root);
  if (known !== undefined) return Effect.succeed(known);
  return Effect.tryPromise((interrupt) =>
    client.get<unknown>(root, {
      maxRetries: 0,
      signal: signal === undefined ? interrupt : AbortSignal.any([interrupt, signal]),
    }),
  ).pipe(
    Effect.timeoutOption(PROBE_TIMEOUT_MS),
    Effect.map(Option.match({ onNone: () => false, onSome: isOllamaRoot })),
    Effect.tap((isOllama) => Effect.sync(() => ollamaRoots.set(root, isOllama))),
    Effect.catch((failure) =>
      Effect.sync(() => {
        if (serverAnswered(failure.cause)) ollamaRoots.set(root, false);
        return false;
      }),
    ),
  );
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
