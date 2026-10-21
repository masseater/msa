import agentLoopModule from "./agent-loop.ts";
import Agent from "./agent.ts";
import proxy from "./proxy.ts";
import streamFnModule from "./stream-fn.ts";
import toolChanges from "./tool-changes.ts";

const agent = {
  Agent: Agent,
  agentLoop: agentLoopModule.agentLoop,
  agentLoopContinue: agentLoopModule.agentLoopContinue,
  declareToolChanges: toolChanges.declareToolChanges,
  runAgentLoop: agentLoopModule.runAgentLoop,
  runAgentLoopContinue: agentLoopModule.runAgentLoopContinue,
  runToolCall: agentLoopModule.runToolCall,
  setDefaultStreamFn: streamFnModule.setDefaultStreamFn,
  streamProxy: proxy.streamProxy,
};

export default agent;
