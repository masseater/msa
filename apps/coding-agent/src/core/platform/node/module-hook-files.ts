import { existsSync, readFileSync, statSync } from "node:fs";

const readTextForModuleHook = (path: string): string => readFileSync(path, "utf8");

const firstRegularFileForModuleHook = (candidates: readonly string[]): string | undefined =>
  candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());

const moduleHookFiles = { firstRegularFileForModuleHook, readTextForModuleHook };

export default moduleHookFiles;
