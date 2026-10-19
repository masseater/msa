import { NodeServices } from "@effect/platform-node";
import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@msa/coding-agent";
import { Effect, ManagedRuntime } from "effect";

import {
  createRemoteBashOps,
  createRemoteEditOps,
  createRemoteReadOps,
  createRemoteWriteOps,
  runSshText,
} from "./ssh-operations.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);

const announceRemote = (
  ctx: ExtensionContext,
  remote: { remote: string; remoteCwd: string },
): void => {
  ctx.ui.setStatus("ssh", ctx.ui.theme.fg("accent", `SSH: ${remote.remote}:${remote.remoteCwd}`));
  ctx.ui.notify(`SSH mode: ${remote.remote}:${remote.remoteCwd}`, "info");
};

const resolveRemote = (msa: ExtensionAPI) =>
  Effect.gen(function* () {
    const arg = msa.getFlag("ssh");
    if (typeof arg !== "string" || arg.length === 0) return undefined;

    if (arg.includes(":")) {
      const [remote = "", path = ""] = arg.split(":");
      return { remote, remoteCwd: path };
    }

    const pwd = yield* Effect.promise(() => runSshText({ remote: arg, command: "pwd" }));
    return { remote: arg, remoteCwd: pwd.trim() };
  });

interface SshTarget {
  readonly remote: string;
  readonly remoteCwd: string;
}

const registerReadTool = (
  msa: ExtensionAPI,
  localCwd: string,
  getSsh: () => SshTarget | null,
): void => {
  const local = createReadTool(localCwd);
  msa.registerTool({
    ...local,
    execute: (id, params, signal, onUpdate) => {
      const ssh = getSsh();
      if (ssh === null) return local.execute(id, params, signal, onUpdate);
      const remote = createReadTool(localCwd, {
        operations: createRemoteReadOps({ remote: ssh.remote, remoteCwd: ssh.remoteCwd, localCwd }),
      });
      return remote.execute(id, params, signal, onUpdate);
    },
  });
};

const registerWriteTool = (
  msa: ExtensionAPI,
  localCwd: string,
  getSsh: () => SshTarget | null,
): void => {
  const local = createWriteTool(localCwd);
  msa.registerTool({
    ...local,
    execute: (id, params, signal, onUpdate) => {
      const ssh = getSsh();
      if (ssh === null) return local.execute(id, params, signal, onUpdate);
      const remote = createWriteTool(localCwd, {
        operations: createRemoteWriteOps({
          remote: ssh.remote,
          remoteCwd: ssh.remoteCwd,
          localCwd,
        }),
      });
      return remote.execute(id, params, signal, onUpdate);
    },
  });
};

const registerEditTool = (
  msa: ExtensionAPI,
  localCwd: string,
  getSsh: () => SshTarget | null,
): void => {
  const local = createEditTool(localCwd);
  msa.registerTool({
    ...local,
    execute: (id, params, signal, onUpdate) => {
      const ssh = getSsh();
      if (ssh === null) return local.execute(id, params, signal, onUpdate);
      const remote = createEditTool(localCwd, {
        operations: createRemoteEditOps({ remote: ssh.remote, remoteCwd: ssh.remoteCwd, localCwd }),
      });
      return remote.execute(id, params, signal, onUpdate);
    },
  });
};

const registerBashTool = (
  msa: ExtensionAPI,
  localCwd: string,
  getSsh: () => SshTarget | null,
): void => {
  const local = createBashTool(localCwd);
  msa.registerTool({
    ...local,
    execute: (id, params, signal, onUpdate) => {
      const ssh = getSsh();
      if (ssh === null) return local.execute(id, params, signal, onUpdate);
      const remote = createBashTool(localCwd, {
        operations: createRemoteBashOps({ remote: ssh.remote, remoteCwd: ssh.remoteCwd, localCwd }),
      });
      return remote.execute(id, params, signal, onUpdate);
    },
  });
};

export default function (msa: ExtensionAPI) {
  const localCwd = process.cwd();
  let resolvedSsh: { remote: string; remoteCwd: string } | null = null;
  const getSsh = () => resolvedSsh;

  msa.registerFlag("ssh", {
    description: "SSH remote: user@host or user@host:/path",
    type: "string",
  });

  registerReadTool(msa, localCwd, getSsh);
  registerWriteTool(msa, localCwd, getSsh);
  registerEditTool(msa, localCwd, getSsh);
  registerBashTool(msa, localCwd, getSsh);

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
        remote: ssh.remote,
        remoteCwd: ssh.remoteCwd,
        localCwd,
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
