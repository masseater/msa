import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const current = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const installExecutable = (path: string, text: string): void => {
  if (current(path) === text) return;
  mkdirSync(dirname(path), { recursive: true });
  const staged = `${path}.${process.pid}.tmp`;
  writeFileSync(staged, text, { mode: 0o755 });
  chmodSync(staged, 0o755);
  renameSync(staged, path);
};

const executableFiles = { installExecutable };

export default executableFiles;
