import type * as NodeOs from "node:os";

import { isNodeRuntime } from "./runtime.ts";

type ProcessWithOsBuiltinModule = typeof process & {
  getBuiltinModule?: (id: "node:os") => typeof NodeOs;
};

function loadNodeOs(): typeof NodeOs | null {
  if (!isNodeRuntime()) return null;
  return (process as ProcessWithOsBuiltinModule).getBuiltinModule?.("node:os") ?? null;
}

const nodeOs = loadNodeOs();

export function getMsaUserAgent(): string {
  return nodeOs === null
    ? "pi (browser)"
    : `pi (${nodeOs.platform()} ${nodeOs.release()}; ${nodeOs.arch()})`;
}
