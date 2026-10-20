import type { AgentMessage } from "@msa/agent-core";
import { Agent } from "@msa/agent-core";
import type { FauxProviderRegistration, Model } from "@msa/ai/compat";
import { streamSimple } from "@msa/ai/compat";

import type { ExtensionRunner } from "../../../src/core/extensions/index.ts";
import { convertToLlm } from "../../../src/core/messages.ts";

type RunnerRef = { current?: ExtensionRunner };

const extensionHooks = (extensionRunnerRef: RunnerRef) => ({
  onPayload: (payload: unknown) => {
    const runner = extensionRunnerRef.current;
    return runner?.hasHandlers("before_provider_request") === true
      ? runner.emitBeforeProviderRequest(payload)
      : Promise.resolve(payload);
  },
  onResponse: (response: { headers: Record<string, string>; status: number }) => {
    const runner = extensionRunnerRef.current;
    if (runner?.hasHandlers("after_provider_response") !== true) return Promise.resolve();
    return runner.emit({
      headers: response.headers,
      status: response.status,
      type: "after_provider_response",
    });
  },
  transformContext: (messages: AgentMessage[]) => {
    const runner = extensionRunnerRef.current;
    return runner === undefined ? Promise.resolve(messages) : runner.emitContext(messages);
  },
});

function createFauxAgent(entry: {
  model: Model<string>;
  fauxProvider: FauxProviderRegistration;
  withConfiguredAuth: boolean;
  extensionRunnerRef: RunnerRef;
}): Agent {
  const { model, withConfiguredAuth, extensionRunnerRef } = entry;
  return new Agent({
    convertToLlm,
    getApiKey: () => (withConfiguredAuth ? "faux-key" : undefined),
    initialState: { model, systemPrompt: "", tools: [] },
    ...extensionHooks(extensionRunnerRef),
    streamFn: streamSimple,
  });
}

const agent = {
  createFauxAgent,
};

export default agent;
