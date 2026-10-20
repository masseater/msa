import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
import { basename, dirname, join, randomUuid, relative, resolve } from "../core/platform-node.ts";
import { nowMs } from "../core/platform.ts";
import { copyFile, exists, makeDirectory, remove, rename } from "./node-fs.ts";
import { getCwdRelativePath } from "./paths.ts";
import { toNamespacedPath } from "./platform-extra.ts";

const QUARANTINE_DIR_NAME = ".msa-native-quarantine";

function normalizePath(path: string): string {
  return toNamespacedPath(resolve(path));
}

function getQuarantineRoot(packageDir: string): string | undefined {
  let current = resolve(packageDir);
  while (true) {
    if (basename(current).toLowerCase() === "node_modules") {
      return join(current, QUARANTINE_DIR_NAME);
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function getLoadedSharedObjectsInPackageDir(packageDir: string): string[] {
  const sharedObjects = (process.report.getReport() as { sharedObjects?: unknown }).sharedObjects;
  if (!Array.isArray(sharedObjects)) {
    return [];
  }

  const root = normalizePath(packageDir).toLowerCase();
  const seen = new Set<string>();
  const loadedFiles: string[] = [];
  for (const value of sharedObjects) {
    if (typeof value !== "string") {
      continue;
    }
    const filePath = normalizePath(value);
    const comparisonPath = filePath.toLowerCase();
    if (getCwdRelativePath(comparisonPath, root) === undefined || seen.has(comparisonPath)) {
      continue;
    }
    seen.add(comparisonPath);
    loadedFiles.push(filePath);
  }
  return loadedFiles;
}

export function cleanupWindowsSelfUpdateQuarantine(packageDir: string): Promise<void> {
  const quarantineRoot = getQuarantineRoot(packageDir);
  if (quarantineRoot === undefined || quarantineRoot === "") {
    return Effect.runPromise(Effect.void);
  }
  return remove({ force: true, path: quarantineRoot, recursive: true }).catch(() => undefined);
}

export function quarantineWindowsNativeDependencies(packageDir: string): Promise<void> {
  const resolvedPackageDir = normalizePath(packageDir);
  const quarantineRoot = getQuarantineRoot(resolvedPackageDir);
  if (quarantineRoot === undefined || quarantineRoot === "") {
    return Effect.runPromise(Effect.void);
  }

  const loadedFiles = getLoadedSharedObjectsInPackageDir(resolvedPackageDir);
  const quarantineRunDir = join(quarantineRoot, `${nowMs()}-${process.pid}-${randomUuid()}`);
  return Effect.runPromise(
    awaiting(function* () {
      for (const loadedFile of loadedFiles) {
        if (!(yield* awaited(exists(loadedFile)))) continue;
        const quarantinePath = join(quarantineRunDir, relative(resolvedPackageDir, loadedFile));
        yield* awaited(makeDirectory({ path: dirname(quarantinePath) }));
        yield* awaited(rename({ from: loadedFile, to: quarantinePath }));
        yield* awaited(copyFile({ from: quarantinePath, to: loadedFile }));
      }
    }),
  );
}
