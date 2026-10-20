import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

import agentSession from "./agent-session.ts";
import type harnessTypesTypes from "./harness-types.ts";

const { throwIfAborted } = agentSession;

const promptAgent = (
  session: codingAgentTypes.AgentSession,
  input: string,
  signal: AbortSignal | undefined,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    yield* throwIfAborted(signal);
    const previousMessageCount = session.messages.length;
    yield* Effect.promise(() => session.prompt(input));
    const assistant = session.messages
      .slice(previousMessageCount)
      .reverse()
      .find((message) => message.role === "assistant");
    if (assistant === undefined) {
      return yield* Effect.die(new Error("Agent run completed without an assistant message."));
    }
    if (assistant.stopReason !== "stop" && assistant.stopReason !== "toolUse") {
      return yield* Effect.die(
        new Error(
          assistant.errorMessage ??
            `Agent run ended with unexpected stop reason: ${assistant.stopReason}.`,
        ),
      );
    }
    const output = session.getLastAssistantText();
    if ((output === undefined || output === "") && assistant.stopReason === "stop") {
      return yield* Effect.die(new Error("Agent run produced no assistant text."));
    }
    return output ?? "";
  });

const runSteps = ({
  session,
  input,
  signal,
}: {
  session: codingAgentTypes.AgentSession;
  input: harnessTypesTypes.MsaCodingAgentInput;
  signal: AbortSignal | undefined;
}): Effect.Effect<string> => {
  const steps = typeof input === "string" ? [{ content: input, type: "prompt" as const }] : input;
  const abortState: { promise?: Promise<void> } = {};
  const abort = () => {
    abortState.promise ??= session.abort();
  };
  const body = Effect.gen(function* () {
    let response: string | undefined;
    for (const step of steps) {
      if (step.type === "reload") yield* Effect.promise(() => session.reload());
      else response = yield* promptAgent(session, step.content, signal);
    }
    if (response === undefined) {
      return yield* Effect.die(new Error("msa eval input must include at least one prompt step."));
    }
    return response;
  });
  return Effect.suspend(() => {
    signal?.addEventListener("abort", abort, { once: true });
    return body;
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() => {
        signal?.removeEventListener("abort", abort);
        const pending = abortState.promise;
        return pending === undefined ? Effect.void : Effect.promise(() => pending);
      }),
    ),
  );
};

const agentSteps = {
  runSteps,
};

export default agentSteps;
