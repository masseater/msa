import { NodeServices } from "@effect/platform-node";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, ManagedRuntime } from "effect";

import sshOperations from "./ssh-operations.ts";

const { createBashTool, createEditTool, createReadTool, createWriteTool } = codingAgent;
const {
  createRemoteBashOps,
  createRemoteEditOps,
  createRemoteReadOps,
  createRemoteWriteOps,
  runSshText,
} = sshOperations;

const runtime = ManagedRuntime.make(NodeServices.layer);

const announceRemote = (
  ctx: codingAgentTypes.ExtensionContext,
  remote: { remote: string; remoteCwd: string },
): void => {
  ctx.ui.setStatus("ssh", ctx.ui.theme.fg("accent", `SSH: ${remote.remote}:${remote.remoteCwd}`));
  ctx.ui.notify(`SSH mode: ${remote.remote}:${remote.remoteCwd}`, "info");
};

const resolveRemote = (msa: codingAgentTypes.ExtensionAPI) =>
  Effect.gen(function* () {
    const arg = msa.getFlag("ssh");
    if (typeof arg !== "string" || arg.length === 0) return undefined;

    if (arg.includes(":")) {
      const [remote = "", path = ""] = arg.split(":");
      return { remote, remoteCwd: path };
    }

    const pwd = yield* Effect.promise(() => runSshText({ command: "pwd", remote: arg }));
    return { remote: arg, remoteCwd: pwd.trim() };
  });

interface SshTarget {
  readonly remote: string;
  readonly remoteCwd: string;
}

interface RemoteTarget extends SshTarget {
  readonly localCwd: string;
}

const registerRemoteTool = <
  Tool extends codingAgentTypes.ToolDefinition & {
    execute: (...args: never[]) => unknown;
  },
  Operations,
>(
  msa: codingAgentTypes.ExtensionAPI,
  localCwd: string,
  getSsh: () => SshTarget | null,
  create: (cwd: string, options?: { operations: Operations }) => Tool,
  remoteOps: (target: RemoteTarget) => Operations,
): void => {
  const local = create(localCwd);
  msa.registerTool({
    ...local,
    execute: (...args: Parameters<Tool["execute"]>) => {
      const ssh = getSsh();
      const tool =
        ssh === null ? local : create(localCwd, { operations: remoteOps({ localCwd, ...ssh }) });
      return tool.execute(...args);
    },
  });
};

export default function (msa: codingAgentTypes.ExtensionAPI) {
  const localCwd = process.cwd();
  let resolvedSsh: { remote: string; remoteCwd: string } | null = null;
  const getSsh = () => resolvedSsh;

  msa.registerFlag("ssh", {
    description: "SSH remote: user@host or user@host:/path",
    type: "string",
  });

  registerRemoteTool(msa, localCwd, getSsh, createReadTool, createRemoteReadOps);
  registerRemoteTool(msa, localCwd, getSsh, createWriteTool, createRemoteWriteOps);
  registerRemoteTool(msa, localCwd, getSsh, createEditTool, createRemoteEditOps);
  registerRemoteTool(msa, localCwd, getSsh, createBashTool, createRemoteBashOps);

  msa.on("session_start", (_event, ctx) => {
    void runtime.runPromise(
      resolveRemote(msa).pipe(
        Effect.flatMap((remote) => {
          if (remote === undefined) return Effect.void;
          resolvedSsh = remote;
          return Effect.sync(() => announceRemote(ctx, remote));
        }),
      ),
    );
  });

  msa.on("user_bash", () => {
    const ssh = getSsh();
    if (ssh === null) return undefined;
    return {
      operations: createRemoteBashOps({
        localCwd,
        remote: ssh.remote,
        remoteCwd: ssh.remoteCwd,
      }),
    };
  });

  msa.on("before_agent_start", (event) => {
    const ssh = getSsh();
    if (ssh === null) return undefined;
    return {
      systemPrompt: event.systemPrompt.replace(
        `Current working directory: ${localCwd}`,
        `Current working directory: ${ssh.remoteCwd} (via SSH: ${ssh.remote})`,
      ),
    };
  });
}
