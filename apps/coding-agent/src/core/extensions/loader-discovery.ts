import { Effect, FileSystem } from "effect";

import { CONFIG_DIR_NAME, getAgentDir } from "../../config.ts";
import { resolvePath } from "../../utils/paths.ts";
import { readMsaManifest } from "../manifest.ts";
import { pathOperations, platformRuntime } from "../platform/index.ts";

const isExtensionFile = (name: string): boolean => name.endsWith(".ts") || name.endsWith(".js");

const existsOrFalse = (path: string) =>
  FileSystem.FileSystem.use((fs) => fs.exists(path)).pipe(Effect.orElseSucceed(() => false));

const manifestEntries = (dir: string) =>
  Effect.gen(function* () {
    const packageJsonPath = pathOperations.join(dir, "package.json");
    if (!(yield* existsOrFalse(packageJsonPath))) return [];
    const manifest = yield* Effect.sync(() => readMsaManifest(packageJsonPath));
    const entries: string[] = [];
    for (const extPath of manifest?.extensions ?? []) {
      const resolvedExtPath = pathOperations.resolve(dir, extPath);
      if (yield* existsOrFalse(resolvedExtPath)) entries.push(resolvedExtPath);
    }
    return entries;
  });

const resolveExtensionEntries = (dir: string) =>
  Effect.gen(function* () {
    const fromManifest = yield* manifestEntries(dir);
    if (fromManifest.length > 0) return fromManifest;
    const indexTs = pathOperations.join(dir, "index.ts");
    if (yield* existsOrFalse(indexTs)) return [indexTs];
    const indexJs = pathOperations.join(dir, "index.js");
    if (yield* existsOrFalse(indexJs)) return [indexJs];
    return null;
  });

type EntryKind = "file" | "directory" | "symlink" | "other";

const entryKind = (entryPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const isSymlink = yield* fs.readLink(entryPath).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (isSymlink) return "symlink" satisfies EntryKind as EntryKind;
    const info = yield* fs.stat(entryPath);
    if (info.type === "File") return "file" satisfies EntryKind as EntryKind;
    return (info.type === "Directory" ? "directory" : "other") satisfies EntryKind as EntryKind;
  });

const discoverInDir = (dir: string) =>
  Effect.gen(function* () {
    if (!(yield* existsOrFalse(dir))) return [];
    const fs = yield* FileSystem.FileSystem;
    const names = yield* fs.readDirectory(dir);
    const discovered: string[] = [];
    for (const name of names) {
      const entryPath = pathOperations.join(dir, name);
      const kind = yield* entryKind(entryPath);
      if ((kind === "file" || kind === "symlink") && isExtensionFile(name)) {
        discovered.push(entryPath);
      } else if (kind === "directory" || kind === "symlink") {
        discovered.push(...((yield* resolveExtensionEntries(entryPath)) ?? []));
      }
    }
    return discovered;
  }).pipe(Effect.orElseSucceed((): string[] => []));

const configuredEntries = (resolved: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const isDirectory = yield* fs.stat(resolved).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    if (!isDirectory) return [resolved];
    const entries = yield* resolveExtensionEntries(resolved);
    return entries ?? (yield* discoverInDir(resolved));
  });

export interface DiscoveryInput {
  configuredPaths: string[];
  cwd: string;
  agentDir?: string;
}

const discover = ({ configuredPaths, cwd, agentDir = getAgentDir() }: DiscoveryInput) =>
  Effect.gen(function* () {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    const allPaths: string[] = [];
    const seen = new Set<string>();
    const addPaths = (paths: string[]) => {
      for (const p of paths) {
        const resolved = pathOperations.resolve(p);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          allPaths.push(p);
        }
      }
    };
    addPaths(yield* discoverInDir(pathOperations.join(resolvedCwd, CONFIG_DIR_NAME, "extensions")));
    addPaths(yield* discoverInDir(pathOperations.join(resolvedAgentDir, "extensions")));
    for (const p of configuredPaths) {
      const resolved = resolvePath(p, resolvedCwd, { normalizeUnicodeSpaces: true });
      addPaths(yield* configuredEntries(resolved));
    }
    return { allPaths, resolvedCwd };
  });

export const discoverExtensionPaths = (
  input: DiscoveryInput,
): Promise<{ resolvedCwd: string; allPaths: string[] }> =>
  platformRuntime.runPromise(discover(input));
