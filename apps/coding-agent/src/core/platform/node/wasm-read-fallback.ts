import fs from "node:fs";
import { fileURLToPath } from "node:url";

type ReadFileSync = typeof fs.readFileSync;
type PathOrFileDescriptor = Parameters<ReadFileSync>[0];

function pathOrNull(file: PathOrFileDescriptor): string | null {
  if (typeof file === "string") return file;
  return file instanceof URL ? fileURLToPath(file) : null;
}

function setReadFileSync(readFileSync: ReadFileSync): void {
  try {
    (fs as { readFileSync: ReadFileSync }).readFileSync = readFileSync;
  } catch {
    Object.defineProperty(fs, "readFileSync", {
      configurable: true,
      value: readFileSync,
      writable: true,
    });
  }
}

function readFallback(options: {
  readFileSync: ReadFileSync;
  fallbackPaths: readonly string[];
  readOptions: Parameters<ReadFileSync>[1];
  error: unknown;
}): ReturnType<ReadFileSync> {
  const code = (options.error as NodeJS.ErrnoException)?.code;
  if (code !== undefined && code !== "" && code !== "ENOENT") throw options.error;
  const fallbackPath = options.fallbackPaths.find((path) => fs.existsSync(path));
  if (fallbackPath === undefined) throw options.error;
  return options.readOptions === undefined
    ? options.readFileSync(fallbackPath)
    : options.readFileSync(fallbackPath, options.readOptions);
}

const redirectMissingWasmRead = (options: {
  fileName: string;
  fallbackPaths: readonly string[];
}): (() => void) => {
  const originalReadFileSync: ReadFileSync = fs.readFileSync.bind(fs);
  const patchedReadFileSync = ((...args: Parameters<ReadFileSync>) => {
    if (pathOrNull(args[0])?.endsWith(options.fileName) !== true) {
      return originalReadFileSync(...args);
    }
    try {
      return originalReadFileSync(...args);
    } catch (error) {
      return readFallback({
        error,
        fallbackPaths: options.fallbackPaths,
        readFileSync: originalReadFileSync,
        readOptions: args[1],
      });
    }
  }) as ReadFileSync;
  setReadFileSync(patchedReadFileSync);
  return () => setReadFileSync(originalReadFileSync);
};

const wasmReadFallback = { redirectMissingWasmRead };

export default wasmReadFallback;
