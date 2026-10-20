import { Effect } from "effect";

import llamaCppHttp from "./llama-cpp-http.ts";
import type llamaCppHttpTypes from "./llama-cpp-http.types.ts";
import llamaCppPrompt from "./llama-cpp-prompt.ts";

const { isRecord, post } = llamaCppHttp;
const { LABEL } = llamaCppPrompt;

function tokenIds(body: unknown): number[] {
  if (!isRecord(body) || !Array.isArray(body["tokens"]))
    throw new Error(`${LABEL} returned an unexpected tokenization`);
  return body["tokens"].map((token) => {
    const id = isRecord(token) ? token["id"] : token;
    if (typeof id !== "number") throw new Error(`${LABEL} returned an unexpected tokenization`);
    return id;
  });
}

const tokenize = (
  request: llamaCppHttpTypes.RequestContext,
  content: string,
): Effect.Effect<number[]> =>
  post(request, {
    body: { add_special: false, content, model: request.model.id, parse_special: false },
    observe: false,
    path: "/tokenize",
  }).pipe(Effect.flatMap((body) => Effect.sync(() => tokenIds(body))));

const labelTokenCache = new Map<string, Promise<number | undefined>>();

const resolveLabelToken = Effect.fn("resolveLabelToken")(function* (
  request: llamaCppHttpTypes.RequestContext,
  label: string,
) {
  const [newline, withLabel] = yield* Effect.all(
    [tokenize(request, "\n"), tokenize(request, `\n${label}`)],
    { concurrency: "unbounded" },
  );
  if (
    withLabel.length === newline.length + 1 &&
    newline.every((id, index) => withLabel[index] === id)
  ) {
    return withLabel[newline.length];
  }
  const alone = yield* tokenize(request, label);
  return alone.length === 1 ? alone[0] : undefined;
});

const cachedLabelToken = (
  request: llamaCppHttpTypes.RequestContext,
  label: string,
): Promise<number | undefined> => {
  const key = `${request.root}\u0000${request.model.id}\u0000${label}`;
  const cached = labelTokenCache.get(key);
  if (cached !== undefined) return cached;
  const pending = Effect.runPromise(resolveLabelToken(request, label));
  labelTokenCache.set(key, pending);
  pending.catch(() => labelTokenCache.delete(key));
  return pending;
};

const labelTokens = Effect.fn("labelTokens")(function* (
  request: llamaCppHttpTypes.RequestContext,
  labels: readonly string[],
) {
  const pending = labels.map((label) => cachedLabelToken(request, label));
  const ids = yield* Effect.promise(() => Promise.all(pending));
  const tokens: number[] = [];
  for (const [index, id] of ids.entries()) {
    if (id === undefined)
      return yield* Effect.die(
        new Error(`Label "${labels[index]}" is not a single token for ${request.model.id}`),
      );
    if (tokens.includes(id))
      return yield* Effect.die(
        new Error(`Labels share a token for ${request.model.id}: ${labels.join(", ")}`),
      );
    tokens.push(id);
  }
  return tokens;
});

const llamaCppTokens = {
  cachedLabelToken,
  labelTokenCache,
  labelTokens,
  resolveLabelToken,
  tokenIds,
  tokenize,
};

export default llamaCppTokens;
