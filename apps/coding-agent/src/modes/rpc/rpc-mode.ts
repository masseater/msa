import { Effect } from "effect";

import type agentSessionRuntimeTypes from "../../core/agent-session-runtime.types.ts";
import outputGuard from "../../core/output-guard.ts";
import RpcServer from "./rpc-mode/rpc-server.ts";

const { takeOverStdout } = outputGuard;

function runRpcMode(runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime): Promise<never> {
  takeOverStdout();
  return Effect.runPromise(new RpcServer(runtimeHost).run());
}

const rpcMode = { runRpcMode };

export default rpcMode;
