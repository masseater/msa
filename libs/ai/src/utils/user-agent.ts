import type * as NodeOs from "node:os";

type ProcessWithOsBuiltinModule = typeof process & {
  getBuiltinModule?: (id: "node:os") => typeof NodeOs;
};

const isPresent = (value: string | undefined): boolean => value !== undefined && value !== "";

function loadNodeOs(): typeof NodeOs | null {
  if (
    typeof process === "undefined" ||
    (!isPresent(process.versions?.node) && !isPresent(process.versions?.["bun"]))
  ) {
    return null;
  }
  return (process as ProcessWithOsBuiltinModule).getBuiltinModule?.("node:os") ?? null;
}

const nodeOs = loadNodeOs();

export function getMsaUserAgent(): string {
  return nodeOs === null
    ? "pi (browser)"
    : `pi (${nodeOs.platform()} ${nodeOs.release()}; ${nodeOs.arch()})`;
}
