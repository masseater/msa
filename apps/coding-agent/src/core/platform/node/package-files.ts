import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const hasPackageJson = (dir: string): boolean => existsSync(join(dir, "package.json"));

const packageRootOf = (dir: string): string => {
  const parent = dirname(dir);
  return basename(dir) === "dist" && hasPackageJson(parent) ? parent : dir;
};

const locatePackageDir = (startDir: string): string => {
  for (let dir = startDir; dir !== dirname(dir); dir = dirname(dir))
    if (hasPackageJson(dir)) return packageRootOf(dir);
  return startDir;
};

const readStartupPackageJson = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const sourceLayoutOf = (packageDir: string): "dist" | "src" =>
  existsSync(join(packageDir, "src")) ? "src" : "dist";

const packageFiles = { locatePackageDir, readStartupPackageJson, sourceLayoutOf };

export default packageFiles;
