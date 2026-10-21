import { dual } from "effect/Function";

import configInstallCommand from "./config-install-command.ts";
import type configInstallCommandTypes from "./config-install-command.types.ts";
import configPackage from "./config-package.ts";
import platformModule from "./core/platform/index.ts";
import nodeOs from "./core/platform/node/os.ts";

const { homedir } = nodeOs;

const { access, exists, realPath } = platformModule.files;

const {
  detectInstallMethod,
  getInferredNpmInstall,
  getSelfUpdateCommandForMethod,
  normalizeSelfUpdatePackageTarget,
  readCommandOutput,
} = configInstallCommand;
const { dirname, join, resolve, sep } = platformModule;
const { RELEASES_URL, getPackageDir } = configPackage;

function getGlobalPackageRoots(
  method: configInstallCommandTypes.InstallMethod,
  _packageName: string,
  npmCommand?: string[],
): string[] {
  switch (method) {
    case "npm": {
      const configured = npmCommand?.length !== undefined && npmCommand?.length !== 0;
      const [command = "npm", ...npmArgs] = npmCommand ?? [];
      if (configured && command === "bun") {
        const bunBin = readCommandOutput(command, [...npmArgs, "pm", "bin", "-g"], {
          requireSuccess: true,
        });
        const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
        if (bunBin !== undefined && bunBin !== "") {
          roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
        }
        return roots;
      }
      const root = readCommandOutput(command, [...npmArgs, "root", "-g"], {
        requireSuccess: configured,
      });
      const inferred = configured ? undefined : getInferredNpmInstall();
      return [root, inferred?.root].filter((x): x is string => x !== undefined && x !== "");
    }
    case "pnpm": {
      const root = readCommandOutput("pnpm", ["root", "-g"]);
      if (root !== undefined && root !== "") return [root, dirname(root)];
      const match = /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/u.exec(getPackageDir());
      const globalDir = match?.[1];
      return globalDir === undefined ? [] : [globalDir];
    }
    case "yarn": {
      const dir = readCommandOutput("yarn", ["global", "dir"]);
      return dir !== undefined && dir !== "" ? [dir, join(dir, "node_modules")] : [];
    }
    case "bun": {
      const bunBin = readCommandOutput("bun", ["pm", "bin", "-g"]);
      const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
      if (bunBin !== undefined && bunBin !== "") {
        roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
      }
      return roots;
    }
    case "bun-binary":
    case "unknown":
      return [];
  }
}

const comparablePath = (path: string): string =>
  process.platform === "win32" ? path.toLowerCase() : path;

function normalizeExistingPathForComparison(
  path: string,
  resolveSymlinks: boolean,
): Promise<string | undefined> {
  const resolvedPath = resolve(path);
  return exists(resolvedPath).then((found) => {
    if (!found) return undefined;
    if (!resolveSymlinks) return comparablePath(resolvedPath);
    return realPath(resolvedPath).then(comparablePath, () => undefined);
  });
}

function getPathComparisonCandidates(path: string): Promise<string[]> {
  return Promise.all([
    normalizeExistingPathForComparison(path, false),
    normalizeExistingPathForComparison(path, true),
  ]).then((candidates) =>
    Array.from(
      new Set(
        candidates.filter(
          (candidate): candidate is string => candidate !== undefined && candidate !== "",
        ),
      ),
    ),
  );
}

function findPackageDirFrom(dir: string): Promise<string | undefined> {
  if (dir === dirname(dir)) return Promise.resolve(undefined);
  return exists(join(dir, "package.json")).then((found) =>
    found ? dir : findPackageDirFrom(dirname(dir)),
  );
}

function getEntrypointPackageDir(): Promise<string | undefined> {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined || entrypoint === "") return Promise.resolve(undefined);
  return findPackageDirFrom(dirname(entrypoint));
}

function isSelfUpdatePathWritable(): Promise<boolean> {
  const packageDir = getPackageDir();
  return Promise.all([
    access(packageDir, { writable: true }),
    access(dirname(packageDir), { writable: true }),
  ]).then(
    () => true,
    () => false,
  );
}

const isUnderRoot = (normalizedRoot: string, packageDirCandidates: readonly string[]): boolean => {
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return packageDirCandidates.some((packageDir) => packageDir.startsWith(rootPrefix));
};

function isManagedByGlobalPackageManager(
  method: configInstallCommandTypes.InstallMethod,
  packageName: string,
  npmCommand?: string[],
): Promise<boolean> {
  return getEntrypointPackageDir().then((entrypointDir) => {
    const packageDirs = [getPackageDir(), entrypointDir].filter(
      (dir): dir is string => dir !== undefined && dir !== "",
    );
    const roots = getGlobalPackageRoots(method, packageName, npmCommand);
    return Promise.all([
      Promise.all(packageDirs.map(getPathComparisonCandidates)),
      Promise.all(roots.map(getPathComparisonCandidates)),
    ]).then(([packageCandidates, rootCandidates]) => {
      const packageDirCandidates = packageCandidates.flat();
      return rootCandidates.flat().some((root) => isUnderRoot(root, packageDirCandidates));
    });
  });
}

function getSelfUpdateCommandImpl(
  packageName: string,
  npmCommand?: string[],
  updatePackageTarget: configInstallCommandTypes.SelfUpdatePackageTarget = packageName,
): Promise<configInstallCommandTypes.SelfUpdateCommand | undefined> {
  const method = detectInstallMethod();
  const command = getSelfUpdateCommandForMethod(
    method,
    packageName,
    updatePackageTarget,
    npmCommand,
  );
  if (command === undefined) return Promise.resolve(undefined);
  return Promise.all([
    isManagedByGlobalPackageManager(method, packageName, npmCommand),
    isSelfUpdatePathWritable(),
  ]).then(([managed, writable]) => (managed && writable ? command : undefined));
}

const getSelfUpdateCommand: {
  (
    packageName: string,
    npmCommand?: string[],
    updatePackageTarget?: configInstallCommandTypes.SelfUpdatePackageTarget,
  ): Promise<configInstallCommandTypes.SelfUpdateCommand | undefined>;
  (
    npmCommand?: string[],
    updatePackageTarget?: configInstallCommandTypes.SelfUpdatePackageTarget,
  ): (packageName: string) => Promise<configInstallCommandTypes.SelfUpdateCommand | undefined>;
} = dual((args: IArguments) => args.length >= 1, getSelfUpdateCommandImpl);

function getSelfUpdateUnavailableInstructionImpl(
  packageName: string,
  npmCommand?: string[],
  updatePackageTarget: configInstallCommandTypes.SelfUpdatePackageTarget = packageName,
): Promise<string> {
  const method = detectInstallMethod();
  const target = normalizeSelfUpdatePackageTarget(updatePackageTarget);
  if (method === "bun-binary") {
    return Promise.resolve(`Download from: ${RELEASES_URL}/latest`);
  }
  const command = getSelfUpdateCommandForMethod(method, packageName, target, npmCommand);
  if (command === undefined) {
    return Promise.resolve(
      `Update ${target.installSpec} using the package manager, wrapper, or source checkout that provides this installation.`,
    );
  }
  return Promise.all([
    isManagedByGlobalPackageManager(method, packageName, npmCommand),
    isSelfUpdatePathWritable(),
  ]).then(([managed, writable]) =>
    managed && !writable
      ? `This installation is managed by a global ${method} install, but the install path is not writable. Update it yourself with: ${command.display}`
      : `This installation is not managed by a global ${method} install. Update it with the package manager, wrapper, or source checkout that provides it.`,
  );
}

const getSelfUpdateUnavailableInstruction: {
  (
    packageName: string,
    npmCommand?: string[],
    updatePackageTarget?: configInstallCommandTypes.SelfUpdatePackageTarget,
  ): Promise<string>;
  (
    npmCommand?: string[],
    updatePackageTarget?: configInstallCommandTypes.SelfUpdatePackageTarget,
  ): (packageName: string) => Promise<string>;
} = dual((args: IArguments) => args.length >= 1, getSelfUpdateUnavailableInstructionImpl);

function getUpdateInstruction(packageName: string): Promise<string> {
  const method = detectInstallMethod();
  const command = getSelfUpdateCommandForMethod(method, packageName);
  if (command !== undefined) {
    return Promise.resolve(`Run: ${command.display}`);
  }
  return getSelfUpdateUnavailableInstruction(packageName);
}

const configInstall = {
  detectInstallMethod: configInstallCommand.detectInstallMethod,
  getSelfUpdateCommand,
  getSelfUpdateUnavailableInstruction,
  getUpdateInstruction,
};

export default configInstall;
