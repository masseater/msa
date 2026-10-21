import type rpcTypesTypes from "./rpc-types.ts";

declare namespace rpcClientInternalTypes {
  type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

  type RpcCommandBody = DistributiveOmit<rpcTypesTypes.RpcCommand, "id">;
}

export type { rpcClientInternalTypes as default };
