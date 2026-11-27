import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import optionalFile from "./optional-file.ts";

const { readOptionalText } = optionalFile;

const installExecutable = (path: string, text: string): void => {
  if (readOptionalText(path) === text) return;
  mkdirSync(dirname(path), { recursive: true });
  const staged = `${path}.${process.pid}.tmp`;
  writeFileSync(staged, text, { mode: 0o755 });
  chmodSync(staged, 0o755);
  renameSync(staged, path);
};

const executableFiles = { installExecutable };

export default executableFiles;
