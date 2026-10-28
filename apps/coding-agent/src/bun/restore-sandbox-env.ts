import platformEnv from "../core/platform/env.ts";
import platformFiles from "../core/platform/files.ts";

const isBun = (): boolean =>
  process.versions?.["bun"] !== undefined && process.versions["bun"] !== "";

const assignEntries = (data: string): void => {
  platformEnv.assignProcessEnv(
    Object.fromEntries(
      data.split("\0").flatMap((entry) => {
        const idx = entry.indexOf("=");
        return idx > 0 ? [[entry.slice(0, idx), entry.slice(idx + 1)] as const] : [];
      }),
    ),
  );
};

function restoreSandboxEnv(): Promise<void> {
  if (!isBun() || Object.keys(process.env).length > 0) return Promise.resolve();
  return platformFiles.readText("/proc/self/environ").then(assignEntries, () => undefined);
}

const restoreSandboxEnvModule = {
  restoreSandboxEnv,
};

export default restoreSandboxEnvModule;
