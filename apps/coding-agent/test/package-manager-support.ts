import { EventEmitter } from "node:events";

import { type ResolvedResource } from "../src/core/package-manager.ts";

export function normalizeForMatch(value: string): string {
  return value.replace(/\\/gu, "/");
}

const pathEndsWith = (actualPath: string, suffix: string): boolean =>
  normalizeForMatch(actualPath).endsWith(normalizeForMatch(suffix));

export const nodeFs = process.getBuiltinModule("node:fs");

const nodeStream = process.getBuiltinModule("node:stream");

export class MockSpawnedProcess extends EventEmitter {
  stdout = new nodeStream.PassThrough();
  stderr = new nodeStream.PassThrough();

  kill(): boolean {
    this.emit("close", null, "SIGTERM");
    return true;
  }
}

export interface PackageManagerInternals {
  runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void>;
  getPackageManagerName(): string;
  getGitDependencyInstallArgs(): string[];
  runCommandCapture(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<string>;
  getLocalGitUpdateTarget(
    installedPath: string,
  ): Promise<{ ref: string; head: string; fetchArgs: string[] }>;
  parseSource(
    source: string,
  ):
    | { type: "npm"; spec: string; name: string; pinned: boolean }
    | { type: "git"; repo: string; host: string; path: string; pinned: boolean; ref?: string }
    | { type: "local"; path: string };
  getNpmInstallPath(
    source: { type: "npm"; spec: string; name: string; pinned: boolean },
    scope: "user" | "project" | "temporary",
  ): string;
  getGitInstallPath(
    source: {
      type: "git";
      repo: string;
      host: string;
      path: string;
      pinned: boolean;
      ref?: string;
    },
    scope: "user" | "project" | "temporary",
  ): string;
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

export const packagePaths = { isDisabled, isEnabled, pathEndsWith };

export const writeJsonFileSync = ({ file, value }: { file: string; value: unknown }): void => {
  nodeFs.writeFileSync(file, JSON.stringify(value));
};
