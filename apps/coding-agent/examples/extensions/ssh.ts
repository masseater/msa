import { spawn } from "node:child_process";

import type { ExtensionAPI } from "@msa/coding-agent";
import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@msa/coding-agent";

function sshExec(remote: string, command: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [remote, command], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (data) => chunks.push(data));
    child.stderr.on("data", (data) => errChunks.push(data));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`SSH failed (${code}): ${Buffer.concat(errChunks).toString()}`));
      }
    });
  });
}

function createRemoteReadOps(remote: string, remoteCwd: string, localCwd: string): ReadOperations {
  const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
  return {
    readFile: (p) => sshExec(remote, `cat ${JSON.stringify(toRemote(p))}`),
    access: (p) => sshExec(remote, `test -r ${JSON.stringify(toRemote(p))}`).then(() => undefined),
    detectImageMimeType: async (p) => {
      try {
        const r = await sshExec(remote, `file --mime-type -b ${JSON.stringify(toRemote(p))}`);
        const m = r.toString().trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(m) ? m : null;
      } catch {
        return null;
      }
    },
  };
}

function createRemoteWriteOps(
  remote: string,
  remoteCwd: string,
  localCwd: string,
): WriteOperations {
  const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
  return {
    writeFile: async (p, content) => {
      const b64 = Buffer.from(content).toString("base64");
      await sshExec(
        remote,
        `echo ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(toRemote(p))}`,
      );
    },
    mkdir: (dir) =>
      sshExec(remote, `mkdir -p ${JSON.stringify(toRemote(dir))}`).then(() => undefined),
  };
}

function createRemoteEditOps(remote: string, remoteCwd: string, localCwd: string): EditOperations {
  const r = createRemoteReadOps(remote, remoteCwd, localCwd);
  const w = createRemoteWriteOps(remote, remoteCwd, localCwd);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function createRemoteBashOps(remote: string, remoteCwd: string, localCwd: string): BashOperations {
  const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
  return {
    exec: (command, cwd, { onData, signal, timeout }) =>
      new Promise((resolve, reject) => {
        const cmd = `cd ${JSON.stringify(toRemote(cwd))} && ${command}`;
        const child = spawn("ssh", [remote, cmd], { stdio: ["ignore", "pipe", "pipe"] });
        let timedOut = false;
        const timer =
          timeout === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                child.kill();
              }, timeout * 1000);
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (e) => {
          if (timer !== undefined) clearTimeout(timer);
          reject(e);
        });
        const onAbort = () => child.kill();
        signal?.addEventListener("abort", onAbort, { once: true });
        child.on("close", (code) => {
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted === true) reject(new Error("aborted"));
          else if (timedOut) reject(new Error(`timeout:${timeout}`));
          else resolve({ exitCode: code });
        });
      }),
  };
}

export default function (msa: ExtensionAPI) {
  msa.registerFlag("ssh", {
    description: "SSH remote: user@host or user@host:/path",
    type: "string",
  });

  const localCwd = process.cwd();
  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);

  let resolvedSsh: { remote: string; remoteCwd: string } | null = null;

  const getSsh = () => resolvedSsh;

  msa.registerTool({
    ...localRead,
    async execute(id, params, signal, onUpdate, _ctx) {
      const ssh = getSsh();
      if (ssh !== null) {
        const tool = createReadTool(localCwd, {
          operations: createRemoteReadOps(ssh.remote, ssh.remoteCwd, localCwd),
        });
        return tool.execute(id, params, signal, onUpdate);
      }
      return localRead.execute(id, params, signal, onUpdate);
    },
  });

  msa.registerTool({
    ...localWrite,
    async execute(id, params, signal, onUpdate, _ctx) {
      const ssh = getSsh();
      if (ssh !== null) {
        const tool = createWriteTool(localCwd, {
          operations: createRemoteWriteOps(ssh.remote, ssh.remoteCwd, localCwd),
        });
        return tool.execute(id, params, signal, onUpdate);
      }
      return localWrite.execute(id, params, signal, onUpdate);
    },
  });

  msa.registerTool({
    ...localEdit,
    async execute(id, params, signal, onUpdate, _ctx) {
      const ssh = getSsh();
      if (ssh !== null) {
        const tool = createEditTool(localCwd, {
          operations: createRemoteEditOps(ssh.remote, ssh.remoteCwd, localCwd),
        });
        return tool.execute(id, params, signal, onUpdate);
      }
      return localEdit.execute(id, params, signal, onUpdate);
    },
  });

  msa.registerTool({
    ...localBash,
    async execute(id, params, signal, onUpdate, _ctx) {
      const ssh = getSsh();
      if (ssh !== null) {
        const tool = createBashTool(localCwd, {
          operations: createRemoteBashOps(ssh.remote, ssh.remoteCwd, localCwd),
        });
        return tool.execute(id, params, signal, onUpdate);
      }
      return localBash.execute(id, params, signal, onUpdate);
    },
  });

  msa.on("session_start", async (_event, ctx) => {
    const arg = msa.getFlag("ssh") as string | undefined;
    if (arg !== undefined && arg.length > 0) {
      if (arg.includes(":")) {
        const [remote = "", path = ""] = arg.split(":");
        resolvedSsh = { remote, remoteCwd: path };
      } else {
        const remote = arg;
        const pwd = (await sshExec(remote, "pwd")).toString().trim();
        resolvedSsh = { remote, remoteCwd: pwd };
      }
      ctx.ui.setStatus(
        "ssh",
        ctx.ui.theme.fg("accent", `SSH: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`),
      );
      ctx.ui.notify(`SSH mode: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`, "info");
    }
  });

  msa.on("user_bash", (_event) => {
    const ssh = getSsh();
    if (ssh === null) return;
    return { operations: createRemoteBashOps(ssh.remote, ssh.remoteCwd, localCwd) };
  });

  msa.on("before_agent_start", async (event) => {
    const ssh = getSsh();
    if (ssh !== null) {
      const modified = event.systemPrompt.replace(
        `Current working directory: ${localCwd}`,
        `Current working directory: ${ssh.remoteCwd} (via SSH: ${ssh.remote})`,
      );
      return { systemPrompt: modified };
    }
    return undefined;
  });
}
