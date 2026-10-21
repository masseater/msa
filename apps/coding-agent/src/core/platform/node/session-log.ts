import { appendFileSync, closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const appendSessionLine = (path: string, line: string): void => {
  appendFileSync(path, line);
};

const writeSessionLines = (options: {
  path: string;
  lines: readonly string[];
  flag: "w" | "wx";
}): void => {
  mkdirSync(dirname(options.path), { recursive: true });
  const fd = openSync(options.path, options.flag);
  try {
    for (const line of options.lines) writeFileSync(fd, line);
  } finally {
    closeSync(fd);
  }
};

const sessionLog = { appendSessionLine, writeSessionLines };

export default sessionLog;
