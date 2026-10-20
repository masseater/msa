import { EventEmitter } from "node:events";

import { type ResolvedResource } from "../src/core/package-manager.ts";

function normalizeForMatch(value: string): string {
  return value.replace(/\\/gu, "/");
}

const pathEndsWith = (actualPath: string, suffix: string): boolean =>
  normalizeForMatch(actualPath).endsWith(normalizeForMatch(suffix));

const fakeOutput = () => {
  const output = new EventEmitter();
  return Object.assign(output, {
    end: () => output.emit("end"),
    write: (chunk: string) => output.emit("data", Buffer.from(chunk)),
  });
};

class MockSpawnedProcess extends EventEmitter {
  stdout = fakeOutput();
  stderr = fakeOutput();

  kill(): boolean {
    this.emit("close", null, "SIGTERM");
    return true;
  }
}

const isEnabled = (
  r: ResolvedResource,
  pathMatch: string,
  matchFn: "endsWith" | "includes" = "endsWith",
) => {
  const normalizedPath = normalizeForMatch(r.path);
  const normalizedMatch = normalizeForMatch(pathMatch);
  return matchFn === "endsWith"
    ? normalizedPath.endsWith(normalizedMatch) && r.enabled
    : normalizedPath.includes(normalizedMatch) && r.enabled;
};

const isDisabled = (
  r: ResolvedResource,
  pathMatch: string,
  matchFn: "endsWith" | "includes" = "endsWith",
) => {
  const normalizedPath = normalizeForMatch(r.path);
  const normalizedMatch = normalizeForMatch(pathMatch);
  return matchFn === "endsWith"
    ? normalizedPath.endsWith(normalizedMatch) && !r.enabled
    : normalizedPath.includes(normalizedMatch) && !r.enabled;
};

const packagePaths = { isDisabled, isEnabled, pathEndsWith };

const packageManagerSupport = {
  MockSpawnedProcess,
  normalizeForMatch,
  packagePaths,
};

export default packageManagerSupport;
