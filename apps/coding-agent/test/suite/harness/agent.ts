import { Agent } from "@msa/agent-core";
import type { AgentMessage } from "@msa/agent-core";
import type { FauxProviderRegistration, Model } from "@msa/ai/compat";
import { streamSimple } from "@msa/ai/compat";
import { Effect } from "effect";

import type { AgentSessionEvent } from "../../../src/core/agent-session.ts";
import type { ExtensionRunner } from "../../../src/core/extensions/index.ts";
import { convertToLlm } from "../../../src/core/messages.ts";

export function createFauxAgent(entry: {
  model: Model<string>;
  fauxProvider: FauxProviderRegistration;
  withConfiguredAuth: boolean;
  extensionRunnerRef: { current?: ExtensionRunner };
}): Agent {
  const { model, withConfiguredAuth, extensionRunnerRef } = entry;
  return new Agent({
    getApiKey: () => (withConfiguredAuth ? "faux-key" : undefined),
    streamFn: streamSimple,
    initialState: {
      model,
      systemPrompt: "",
      tools: [],
    },
    convertToLlm,
    onPayload: (payload) =>
      Effect.runPromise(
        Effect.sync(() => {
          const runner = extensionRunnerRef.current;
          if (runner?.hasHandlers("before_provider_request") !== true) {
            return payload;
          }
          return runner.emitBeforeProviderRequest(payload);
        }),
      ),
    onResponse: (response) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runner = extensionRunnerRef.current;
          if (runner?.hasHandlers("after_provider_response") !== true) {
            return;
          }
          yield* Effect.promise(() =>
            runner.emit({
              type: "after_provider_response",
              status: response.status,
              headers: response.headers,
            }),
          );
        }),
      ),
    transformContext: (messages: AgentMessage[]) =>
      Effect.runPromise(
        Effect.promise(() => {
          const runner = extensionRunnerRef.current;
          if (runner === undefined) return Promise.resolve(messages);
          return runner.emitContext(messages);
        }),
      ),
  });
}

export type { AgentSessionEvent };
