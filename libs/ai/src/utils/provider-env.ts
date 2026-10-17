import { Function } from "effect";

import type { ProviderEnv } from "../types.ts";
import { readProcessEnv } from "./env.ts";

let procEnvCache: Map<string, string> | null = null;

function getBunSandboxEnvValue(name: string): string | undefined {
  if (
    typeof process === "undefined" ||
    process.versions?.["bun"] === undefined ||
    process.versions?.["bun"] === "" ||
    Object.keys(process.env).length > 0
  ) {
    return undefined;
  }

  if (procEnvCache === null) {
    procEnvCache = new Map();
    try {
      const { readFileSync } = require("node:fs") as {
        readFileSync(path: string, encoding: BufferEncoding): string;
      };
      const data = readFileSync("/proc/self/environ", "utf-8");
      for (const entry of data.split("\0")) {
        const idx = entry.indexOf("=");
        if (idx > 0) {
          procEnvCache.set(entry.slice(0, idx), entry.slice(idx + 1));
        }
      }
    } catch {}
  }

  return procEnvCache.get(name);
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

export const getProviderEnvValue: {
  (env?: ProviderEnv): (name: string) => string | undefined;
  (name: string, env?: ProviderEnv): string | undefined;
} = Function.dual(
  (args) => typeof args[0] === "string",
  (name: string, env?: ProviderEnv): string | undefined =>
    nonEmpty(env?.[name]) ??
    nonEmpty(typeof process === "undefined" ? undefined : readProcessEnv(name)) ??
    nonEmpty(getBunSandboxEnvValue(name)),
);
