import platformModule from "./platform/index.ts";
import nodeFsPromises from "./platform/node/fs-promises.ts";

const { join } = platformModule;
const { stat } = platformModule.files;

type DirectoryEntry = Awaited<ReturnType<typeof nodeFsPromises.readDirectoryEntries>>[number];

type ResolvedEntry = { fullPath: string; isDir: boolean; isFile: boolean };

function resolveEntry(dir: string, entry: DirectoryEntry): Promise<ResolvedEntry | undefined> {
  const fullPath = join(dir, entry.name);
  if (!entry.isSymbolicLink) {
    return Promise.resolve({ fullPath, isDir: entry.isDirectory, isFile: entry.isFile });
  }
  return stat(fullPath).then(
    (info) => ({ fullPath, isDir: info.isDirectory, isFile: info.isFile }),
    () => undefined,
  );
}

const readEntries = (dir: string): Promise<DirectoryEntry[]> =>
  nodeFsPromises.readDirectoryEntries(dir);

const directoryEntry = { readEntries, resolveEntry };

export default directoryEntry;
