import { Function } from "effect";

import type typesModule from "../types.types.ts";
import envModule from "./env.ts";

const { readProcessEnv } = envModule;

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

const getProviderEnvValue: {
  (env?: typesModule.ProviderEnv): (name: string) => string | undefined;
  (name: string, env?: typesModule.ProviderEnv): string | undefined;
} = Function.dual(
  (args) => typeof args[0] === "string",
  (name: string, env?: typesModule.ProviderEnv): string | undefined =>
    nonEmpty(env?.[name]) ??
    nonEmpty(typeof process === "undefined" ? undefined : readProcessEnv(name)) ??
    nonEmpty(getBunSandboxEnvValue(name)),
);

const providerEnv = {
  getProviderEnvValue,
};

export default providerEnv;
