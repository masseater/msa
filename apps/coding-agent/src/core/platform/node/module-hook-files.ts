import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { enableCompileCache } from "node:module";
import { join } from "node:path";

const readTextForModuleHook = (path: string): string => readFileSync(path, "utf8");

const firstRegularFileForModuleHook = (candidates: readonly string[]): string | undefined =>
  candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());

const digestForModuleHook = (parts: readonly string[]): string => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
};

const sourcesInForModuleHook = (directory: string, extension: string): readonly string[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .sort()
    .flatMap((name) => [name, readTextForModuleHook(join(directory, name))]);

const compileCacheForModuleHook = (): string | undefined => enableCompileCache().directory;

const cachedForModuleHook = (
  directory: string | undefined,
  key: string,
  make: () => string,
): string => {
  if (directory === undefined) return make();
  const path = join(directory, key);
  if (existsSync(path)) return readTextForModuleHook(path);
  const made = make();
  mkdirSync(directory, { recursive: true });
  const written = `${path}.${process.pid}.tmp`;
  writeFileSync(written, made);
  renameSync(written, path);
  return made;
};

const moduleHookFiles = {
  cachedForModuleHook,
  compileCacheForModuleHook,
  digestForModuleHook,
  firstRegularFileForModuleHook,
  readTextForModuleHook,
  sourcesInForModuleHook,
};

export default moduleHookFiles;
