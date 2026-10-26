import type compatTypes from "@msa/ai/compat.types";
import { Effect, Schema, Stream } from "effect";

import claudeAccounts from "../src/core/cli-agents/claude-accounts.ts";
import type claudeAccountsTypes from "../src/core/cli-agents/claude-accounts.types.ts";
import claudeCode from "../src/core/cli-agents/claude-code.ts";

const { blockIfUnusable, loadAccounts } = claudeAccounts;
const { claudeCodeProviders } = claudeCode;

class StreamFailed extends Schema.TaggedError<StreamFailed, { readonly brand: unique symbol }>()(
  "StreamFailed",
  { cause: Schema.Unknown },
) {}

const blockAccounts = (failures: readonly claudeAccountsTypes.RunFailure[]) =>
  Effect.gen(function* () {
    const accounts = yield* Effect.promise(() => loadAccounts());
    for (const [index, failure] of failures.entries()) {
      const account = accounts[index];
      if (account === undefined) throw new Error(`no account ${index}`);
      yield* Effect.promise(() => blockIfUnusable(account, failure));
    }
  });

const claudeSubsFailure = Effect.gen(function* () {
  const provider = claudeCodeProviders()[0]!;
  const model = provider.getModels()[0]!;
  const context = {
    messages: [{ content: "hello", role: "user", timestamp: 0 }],
  } as unknown as compatTypes.TranscriptContext;
  const events: compatTypes.AssistantMessageEvent[] = [];
  yield* Stream.runForEach(
    Stream.fromAsyncIterable(provider.streamSimple(model, context), (cause) =>
      StreamFailed.make({ cause }),
    ),
    (event) => Effect.sync(() => events.push(event)),
  ).pipe(Effect.orDie);
  const last = events.at(-1);
  if (last?.type !== "error") throw new Error(`claude-subs ended with ${last?.type}`);
  return last.error;
});

const claudeSubsFailureSupport = { blockAccounts, claudeSubsFailure };

export default claudeSubsFailureSupport;
