import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const writeCrashFileBeforeExit = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const crashFiles = { writeCrashFileBeforeExit };

export default crashFiles;
