import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const readCrashFileBeforeExit = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const writeCrashFileBeforeExit = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const crashFiles = { readCrashFileBeforeExit, writeCrashFileBeforeExit };

export default crashFiles;
