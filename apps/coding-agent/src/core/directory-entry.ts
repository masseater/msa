import platformModule from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";

const { join } = platformModule;
const { statSync } = nodeFs;

type DirectoryEntry = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

type ResolvedEntry = { fullPath: string; isDir: boolean; isFile: boolean };

function resolveEntry(dir: string, entry: DirectoryEntry): ResolvedEntry | undefined {
  const fullPath = join(dir, entry.name);
  if (!entry.isSymbolicLink()) {
    return { fullPath, isDir: entry.isDirectory(), isFile: entry.isFile() };
  }
  try {
    const stats = statSync(fullPath);
    return { fullPath, isDir: stats.isDirectory(), isFile: stats.isFile() };
  } catch {
    return undefined;
  }
}

const directoryEntry = { resolveEntry };

export default directoryEntry;
