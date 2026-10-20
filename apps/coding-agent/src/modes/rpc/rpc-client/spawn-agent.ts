import nodeChildProcess from "../../../core/platform/node/child-process.ts";
import type nodeChildProcessTypes from "../../../core/platform/node/child-process.types.ts";
import processEnv from "../../../core/process-env.ts";
import type rpcClientTypes from "../rpc-client.types.ts";

const { spawn } = nodeChildProcess;
const { envSnapshot } = processEnv;

const agentArgs = (options: rpcClientTypes.RpcClientOptions): string[] => {
  const args = ["--mode", "rpc"];
  if (options.provider !== undefined && options.provider !== "") {
    args.push("--provider", options.provider);
  }
  if (options.model !== undefined && options.model !== "") {
    args.push("--model", options.model);
  }
  if (options.args !== undefined) {
    args.push(...options.args);
  }
  return args;
};

const spawnAgent = (options: rpcClientTypes.RpcClientOptions): nodeChildProcessTypes.ChildProcess =>
  spawn("node", [options.cliPath ?? "dist/cli.js", ...agentArgs(options)], {
    cwd: options.cwd,
    env: { ...envSnapshot(), ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

export default spawnAgent;
