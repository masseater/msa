import type agentConfigTypes from "./agent-config.types.ts";
import type typesModule from "./types.ts";

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

const nextTurnHook = (
  source: agentConfigTypes.LoopConfigSource,
): typesModule.AgentLoopConfig["prepareNextTurn"] => {
  const initial = source.nextTurnHooks();
  if (initial.prepareNextTurnWithContext === undefined && initial.prepareNextTurn === undefined) {
    return undefined;
  }
  return (context) => {
    const { prepareNextTurn, prepareNextTurnWithContext } = source.nextTurnHooks();
    if (prepareNextTurnWithContext !== undefined) {
      return prepareNextTurnWithContext(context, source.signal());
    }
    return prepareNextTurn?.(source.signal());
  };
};

const createLoopConfig = (
  source: agentConfigTypes.LoopConfigSource,
): typesModule.AgentLoopConfig => {
  let skipInitialSteeringPoll = source.skipInitialSteeringPoll;
  const { state } = source;
  return {
    afterToolCall: source.afterToolCall,
    beforeToolCall: source.beforeToolCall,
    convertToLlm: source.convertToLlm,
    finishTurn: source.finishTurn,
    getApiKey: source.getApiKey,
    getFollowUpMessages: () => Promise.resolve(source.followUps.drain()),
    getSteeringMessages: () => {
      if (skipInitialSteeringPoll) {
        skipInitialSteeringPoll = false;
        return Promise.resolve([]);
      }
      return Promise.resolve(source.steering.drain());
    },
    model: state.model,
    prepareNextTurn: nextTurnHook(source),
    prepareRequest: source.prepareRequest,
    toolExecution: source.toolExecution,
    transformContext: source.transformContext,
    transport: source.transport,
    ...(state.thinkingLevel === "off" ? {} : { reasoning: state.thinkingLevel }),
    ...optional("sessionId", source.sessionId),
    ...optional("onPayload", source.onPayload),
    ...optional("onResponse", source.onResponse),
    ...optional("onProviderStreamEvent", source.onProviderStreamEvent),
    ...optional("thinkingBudgets", source.thinkingBudgets),
    ...optional("maxRetryDelayMs", source.maxRetryDelayMs),
  };
};

const agentConfig = {
  createLoopConfig,
};

export default agentConfig;
