import InteractiveMode from "./interactive/interactive-mode.ts";
import printMode from "./print-mode.ts";
import RpcClient from "./rpc/rpc-client.ts";
import rpcMode from "./rpc/rpc-mode.ts";

const modes = {
  InteractiveMode: InteractiveMode,
  RpcClient: RpcClient,
  runPrintMode: printMode.runPrintMode,
  runRpcMode: rpcMode.runRpcMode,
};

export default modes;
