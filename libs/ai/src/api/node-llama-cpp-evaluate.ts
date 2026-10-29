import { Effect, Semaphore } from "effect";
import type { Token } from "node-llama-cpp";

import type nodeLlamaCppClassifyTypes from "./node-llama-cpp-classify.types.ts";

type LoadedModel = nodeLlamaCppClassifyTypes.LoadedModel;

const LABEL = "node-llama-cpp";
const EVALUATION_CHUNK = 128;

const lastTokenProbabilities = (loaded: LoadedModel, token: Token) =>
  Effect.gen(function* () {
    const evaluation = loaded.sequence.evaluateWithMetadata([token], { probabilities: true });
    const step = yield* Effect.tryPromise(() => evaluation.next());
    yield* Effect.promise(() => evaluation.return());
    if (step.done === true) return yield* Effect.die(new Error(`${LABEL} returned no next token`));
    return step.value.probabilities;
  });

const evaluateUpTo = (loaded: LoadedModel, tokens: Token[], end: number) =>
  Effect.gen(function* () {
    for (let start = loaded.sequence.nextTokenIndex; start < end; start += EVALUATION_CHUNK) {
      const chunk = tokens.slice(start, Math.min(start + EVALUATION_CHUNK, end));
      yield* Effect.uninterruptible(
        Effect.promise(() => loaded.sequence.evaluateWithoutGeneratingNewTokens(chunk)),
      );
    }
  });

const nextTokenProbabilities = (loaded: LoadedModel, tokens: Token[], shared: number) =>
  Effect.gen(function* () {
    const { sequence } = loaded;
    const prefix = tokens.slice(0, -1);
    yield* Effect.uninterruptible(Effect.promise(() => sequence.adaptStateToTokens(prefix, false)));
    yield* evaluateUpTo(loaded, prefix, shared);
    const atShared = sequence.nextTokenIndex === shared;
    if (atShared && sequence.needsCheckpoints && sequence.lastCheckpointIndex !== shared - 1)
      yield* Effect.uninterruptible(Effect.promise(() => sequence.takeCheckpoint()));
    yield* evaluateUpTo(loaded, prefix, prefix.length);
    const last = tokens.at(-1);
    if (last === undefined) return yield* Effect.die(new Error(`${LABEL} got an empty prompt`));
    return yield* Effect.uninterruptible(lastTokenProbabilities(loaded, last));
  }).pipe(Semaphore.withPermit(loaded.lock));

function sharedPrefixLength(prompts: readonly Token[][]): number {
  const [first, ...rest] = prompts;
  if (first === undefined) return 0;
  let length = first.length - 1;
  for (const tokens of rest) {
    let index = 0;
    while (index < length && index < tokens.length - 1 && tokens[index] === first[index]) index++;
    length = index;
  }
  return length;
}

const nodeLlamaCppEvaluate = { LABEL, nextTokenProbabilities, sharedPrefixLength };

export default nodeLlamaCppEvaluate;
