import type rpcTypesTypes from "./rpc-types.ts";

declare namespace rpcModeTypes {
  type RpcCommand = rpcTypesTypes.RpcCommand;

  type RpcExtensionUIRequest = rpcTypesTypes.RpcExtensionUIRequest;

  type RpcExtensionUIResponse = rpcTypesTypes.RpcExtensionUIResponse;

  type RpcResponse = rpcTypesTypes.RpcResponse;

  type RpcSessionState = rpcTypesTypes.RpcSessionState;
}

export type { rpcModeTypes as default };
