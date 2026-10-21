import type interactiveModeTypes from "./interactive/interactive-mode.types.ts";
import type jsonEventTypes from "./json-event.types.ts";
import type printModeTypes from "./print-mode.types.ts";
import type rpcClientTypes from "./rpc/rpc-client.types.ts";
import type rpcTypesTypes from "./rpc/rpc-types.ts";

declare namespace modesTypes {
  type InteractiveMode = interactiveModeTypes.InteractiveMode;

  type InteractiveModeOptions = interactiveModeTypes.InteractiveModeOptions;

  type JsonAgentSessionEvent = jsonEventTypes.JsonAgentSessionEvent;

  type PrintModeOptions = printModeTypes.PrintModeOptions;

  type ModelInfo = rpcClientTypes.ModelInfo;

  type RpcClient = rpcClientTypes.RpcClient;

  type RpcClientOptions = rpcClientTypes.RpcClientOptions;

  type RpcEventListener = rpcClientTypes.RpcEventListener;

  type RpcCommand = rpcTypesTypes.RpcCommand;

  type RpcExtensionUIRequest = rpcTypesTypes.RpcExtensionUIRequest;

  type RpcExtensionUIResponse = rpcTypesTypes.RpcExtensionUIResponse;

  type RpcResponse = rpcTypesTypes.RpcResponse;

  type RpcSessionState = rpcTypesTypes.RpcSessionState;
}

export type { modesTypes as default };
