import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";

const fileRevision = (path: string): Promise<string | undefined> =>
  stat(path, { bigint: true }).then(
    (stats) => `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`,
    () => undefined,
  );

const readDirectoryEntries = (
  dir: string,
): Promise<{ name: string; isDirectory: boolean; isFile: boolean; isSymbolicLink: boolean }[]> =>
  readdir(dir, { withFileTypes: true }).then((entries) =>
    entries.map((entry) => ({
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
      name: entry.name,
    })),
  );

const nodeFsPromises = {
  fileRevision,
  mkdir,
  readDirectoryEntries,
  readFile,
  readdir,
  stat,
  writeFile,
};

export default nodeFsPromises;
