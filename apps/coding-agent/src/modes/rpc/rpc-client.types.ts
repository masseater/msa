import type jsonEventTypes from "../json-event.types.ts";
import type RpcClientClass from "./rpc-client.ts";

declare namespace rpcClientTypes {
  interface RpcClientOptions {
    cliPath?: string;
    cwd?: string;
    env?: Record<string, string>;
    provider?: string;
    model?: string;
    args?: string[];
  }

  interface ModelInfo {
    provider: string;
    id: string;
    contextWindow: number;
    reasoning: boolean;
  }

  type RpcEventListener = (event: jsonEventTypes.JsonAgentSessionEvent) => void;

  type RpcClient = (typeof RpcClientClass)["prototype"];
}

export type { rpcClientTypes as default };
