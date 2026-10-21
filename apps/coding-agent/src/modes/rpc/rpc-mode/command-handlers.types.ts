import type rpcTypesTypes from "../rpc-types.ts";
import type RpcServer from "./rpc-server.ts";

declare namespace commandHandlersTypes {
  type CommandType = rpcTypesTypes.RpcCommand["type"];

  type CommandOf<K extends CommandType> = Extract<rpcTypesTypes.RpcCommand, { type: K }>;

  type Result =
    | rpcTypesTypes.RpcResponse
    | undefined
    | Promise<rpcTypesTypes.RpcResponse | undefined>;

  type Handler<K extends CommandType> = (server: RpcServer, command: CommandOf<K>) => Result;

  type Handlers<K extends CommandType> = { [P in K]: Handler<P> };
}

export type { commandHandlersTypes as default };
