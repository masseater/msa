import nodeFs from "../core/platform/node/fs.ts";

const { readFileSync } = nodeFs;

function restoreSandboxEnv(): void {
  if (process.versions?.["bun"] === undefined || process.versions?.["bun"] === "") return;

  if (Object.keys(process.env).length > 0) return;

  try {
    const data = readFileSync("/proc/self/environ", "utf-8");
    for (const entry of data.split("\0")) {
      const idx = entry.indexOf("=");
      if (idx > 0) {
        Object.assign(process.env, { [entry.slice(0, idx)]: entry.slice(idx + 1) });
      }
    }
  } catch {}
}

const restoreSandboxEnvModule = {
  restoreSandboxEnv,
};

export default restoreSandboxEnvModule;
