import outputGuard from "../../../core/output-guard.ts";
import jsonl from "../jsonl.ts";
import type rpcTypesTypes from "../rpc-types.ts";

const { writeRawStdout } = outputGuard;
const { serializeJsonLine } = jsonl;

function output(
  obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object,
): void {
  writeRawStdout(serializeJsonLine(obj));
}

function success<T extends rpcTypesTypes.RpcCommand["type"]>(
  id: string | undefined,
  command: T,
  data?: object | null,
): rpcTypesTypes.RpcResponse {
  if (data === undefined) {
    return { command, id, success: true, type: "response" } as rpcTypesTypes.RpcResponse;
  }
  return { command, data, id, success: true, type: "response" } as rpcTypesTypes.RpcResponse;
}

function error(
  id: string | undefined,
  command: string,
  message: string,
): rpcTypesTypes.RpcResponse {
  return { command, error: message, id, success: false, type: "response" };
}

const rpcOutput = { error, output, success };

export default rpcOutput;
