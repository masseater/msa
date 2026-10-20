import agentModule from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import type { ExtensionRunner } from "../../../src/core/extensions/index.ts";
import { convertToLlm } from "../../../src/core/messages.ts";

const { streamSimple } = compat;

const { Agent } = agentModule;

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
  transformContext: (messages: agentTypes.AgentMessage[]) => {
    const runner = extensionRunnerRef.current;
    return runner === undefined ? Promise.resolve(messages) : runner.emitContext(messages);
  },
});

function createFauxAgent(entry: {
  model: compatTypes.Model<string>;
  fauxProvider: compatTypes.FauxProviderRegistration;
  withConfiguredAuth: boolean;
  extensionRunnerRef: RunnerRef;
}): agentTypes.Agent {
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
