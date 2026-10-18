import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { type ResolvedResource } from "../src/core/package-manager.ts";

export function normalizeForMatch(value: string): string {
  return value.replace(/\\/gu, "/");
}

export function pathEndsWith(actualPath: string, suffix: string): boolean {
  return normalizeForMatch(actualPath).endsWith(normalizeForMatch(suffix));
}

export class MockSpawnedProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();

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

export const isEnabled = (
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

export const isDisabled = (
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
