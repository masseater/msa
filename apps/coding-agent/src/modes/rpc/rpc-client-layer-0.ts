import type nodeChildProcessTypes from "../../core/platform/node/child-process.types.ts";
import type rpcClientTypes from "./rpc-client.types.ts";
import type rpcTypesTypes from "./rpc-types.ts";

export default abstract class RpcClientLayer0 {
  constructor(options: rpcClientTypes.RpcClientOptions = {}) {
    this.options = options;
  }

  protected process: nodeChildProcessTypes.ChildProcess | null = null;
  protected stopReadingStdout: (() => void) | null = null;
  protected eventListeners: rpcClientTypes.RpcEventListener[] = [];
  protected pendingRequests: Map<
    string,
    { resolve: (response: rpcTypesTypes.RpcResponse) => void; reject: (error: Error) => void }
  > = new Map();
  protected requestId = 0;
  protected stderr = "";
  protected exitError: Error | null = null;
  protected options!: rpcClientTypes.RpcClientOptions;
}
