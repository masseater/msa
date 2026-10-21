import platformFiles from "../core/platform/files.ts";

const isBun = (): boolean =>
  process.versions?.["bun"] !== undefined && process.versions["bun"] !== "";

const assignEntries = (data: string): void => {
  for (const entry of data.split("\0")) {
    const idx = entry.indexOf("=");
    if (idx > 0) Object.assign(process.env, { [entry.slice(0, idx)]: entry.slice(idx + 1) });
  }
};

function restoreSandboxEnv(): Promise<void> {
  if (!isBun() || Object.keys(process.env).length > 0) return Promise.resolve();
  return platformFiles.readText("/proc/self/environ").then(assignEntries, () => undefined);
}

const restoreSandboxEnvModule = {
  restoreSandboxEnv,
};

export default restoreSandboxEnvModule;
