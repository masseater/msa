import type rpcTypesTypes from "../rpc-types.ts";
import type commandHandlersTypes from "./command-handlers.types.ts";
import modelCommands from "./model-commands.ts";
import promptingCommands from "./prompting-commands.ts";
import rpcOutput from "./rpc-output.ts";
import type RpcServer from "./rpc-server.ts";
import sessionCommands from "./session-commands.ts";

const { error } = rpcOutput;

const HANDLERS: commandHandlersTypes.Handlers<commandHandlersTypes.CommandType> = {
  ...promptingCommands,
  ...modelCommands,
  ...sessionCommands,
};

type AnyHandler = (
  server: RpcServer,
  command: rpcTypesTypes.RpcCommand,
) => commandHandlersTypes.Result;

function handleCommand(
  server: RpcServer,
  command: rpcTypesTypes.RpcCommand,
): commandHandlersTypes.Result {
  const type = (command as { type: string }).type;
  if (!Object.hasOwn(HANDLERS, type)) return error(command.id, type, `Unknown command: ${type}`);
  return (HANDLERS[command.type] as AnyHandler)(server, command);
}

const commands = { handleCommand };

export default commands;
