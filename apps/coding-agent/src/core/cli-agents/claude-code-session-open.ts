import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import claudeAccounts from "./claude-accounts.ts";
import ClaudeCodeFailure from "./claude-code-failure.ts";
import claudeCodeSdk from "./claude-code-sdk.ts";
import Session from "./claude-code-session.ts";
import type claudeCodeSessionTypes from "./claude-code-session.types.ts";
import transcript from "./transcript.ts";

const { accountEnv } = claudeAccounts;
const { loadSdk } = claudeCodeSdk;
const { flattenTranscript } = transcript;

type Config = claudeCodeSessionTypes.SessionConfig;

const transcriptPrompt = (messages: readonly compatTypes.Message[]) =>
  [
    "The transcript below is the conversation so far. Continue it as the assistant.",
    "",
    "----- conversation transcript -----",
    "",
    flattenTranscript(messages),
    "",
    "----- end of transcript -----",
    "",
    "Reply now as the assistant to the last message.",
  ].join("\n");

const openSession = (messages: readonly compatTypes.Message[], config: Config) =>
  Effect.gen(function* () {
    const account = config.accounts[0];
    if (account === undefined)
      return yield* new ClaudeCodeFailure({ message: "No Claude account available" });
    const failure = (cause: unknown) => ClaudeCodeFailure.fromCause(cause);
    const sdk = yield* Effect.tryPromise({ catch: failure, try: loadSdk });
    const env = yield* Effect.tryPromise({ catch: failure, try: () => accountEnv(account) });
    const session = yield* Effect.try({
      catch: failure,
      try: () => new Session(sdk, config, account, env),
    });
    session.busy = true;
    session.send([{ text: transcriptPrompt(messages), type: "text" }]);
    return session;
  });

const claudeCodeSessionOpen = { openSession };

export default claudeCodeSessionOpen;
