import { dual } from "effect/Function";

import configInstallCommand from "./config-install-command.ts";
import type configInstallCommandTypes from "./config-install-command.types.ts";
import configPackage from "./config-package.ts";
import platformModule from "./core/platform/index.ts";
import nodeFs from "./core/platform/node/fs.ts";
import nodeOs from "./core/platform/node/os.ts";

const { homedir } = nodeOs;

const { accessSync, constants, existsSync, realpathSync } = nodeFs;

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

function normalizeExistingPathForComparison(
  path: string,
  resolveSymlinks: boolean,
): string | undefined {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) {
    return undefined;
  }
  let normalizedPath = resolvedPath;
  if (resolveSymlinks) {
    try {
      normalizedPath = realpathSync(resolvedPath);
    } catch {
      return undefined;
    }
  }
  if (process.platform === "win32") {
    normalizedPath = normalizedPath.toLowerCase();
  }
  return normalizedPath;
}

function getPathComparisonCandidates(path: string): string[] {
  return Array.from(
    new Set(
      [
        normalizeExistingPathForComparison(path, false),
        normalizeExistingPathForComparison(path, true),
      ].filter((candidate): candidate is string => candidate !== undefined && candidate !== ""),
    ),
  );
}

function getEntrypointPackageDir(): string | undefined {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined || entrypoint === "") return undefined;
  let dir = dirname(entrypoint);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return undefined;
}

function isSelfUpdatePathWritable(): boolean {
  const packageDir = getPackageDir();
  try {
    accessSync(packageDir, constants.W_OK);
    accessSync(dirname(packageDir), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isManagedByGlobalPackageManager(
  method: configInstallCommandTypes.InstallMethod,
  packageName: string,
  npmCommand?: string[],
): boolean {
  const packageDirs = [getPackageDir(), getEntrypointPackageDir()].filter(
    (dir): dir is string => dir !== undefined && dir !== "",
  );
  const packageDirCandidates = packageDirs.flatMap((dir) => getPathComparisonCandidates(dir));
  return getGlobalPackageRoots(method, packageName, npmCommand).some((root) =>
    getPathComparisonCandidates(root).some((normalizedRoot) => {
      const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
      return packageDirCandidates.some((packageDir) => packageDir.startsWith(rootPrefix));
    }),
  );
}

function getSelfUpdateCommandImpl(
  packageName: string,
  npmCommand?: string[],
  updatePackageTarget: configInstallCommandTypes.SelfUpdatePackageTarget = packageName,
): configInstallCommandTypes.SelfUpdateCommand | undefined {
  const method = detectInstallMethod();
  const command = getSelfUpdateCommandForMethod(
    method,
    packageName,
    updatePackageTarget,
    npmCommand,
  );
  if (
    command === undefined ||
    !isManagedByGlobalPackageManager(method, packageName, npmCommand) ||
    !isSelfUpdatePathWritable()
  ) {
    return undefined;
  }
  return command;
}

const getSelfUpdateCommand: {
  (
    packageName: string,
    npmCommand?: string[],
    updatePackageTarget?: configInstallCommandTypes.SelfUpdatePackageTarget,
  ): configInstallCommandTypes.SelfUpdateCommand | undefined;
  (
    npmCommand?: string[],
    updatePackageTarget?: configInstallCommandTypes.SelfUpdatePackageTarget,
  ): (packageName: string) => configInstallCommandTypes.SelfUpdateCommand | undefined;
} = dual((args: IArguments) => args.length >= 1, getSelfUpdateCommandImpl);

function getSelfUpdateUnavailableInstructionImpl(
  packageName: string,
  npmCommand?: string[],
  updatePackageTarget: configInstallCommandTypes.SelfUpdatePackageTarget = packageName,
): string {
  const method = detectInstallMethod();
  const target = normalizeSelfUpdatePackageTarget(updatePackageTarget);
  if (method === "bun-binary") {
    return `Download from: ${RELEASES_URL}/latest`;
  }
  const command = getSelfUpdateCommandForMethod(method, packageName, target, npmCommand);
  if (command !== undefined) {
    if (
      isManagedByGlobalPackageManager(method, packageName, npmCommand) &&
      !isSelfUpdatePathWritable()
    ) {
      return `This installation is managed by a global ${method} install, but the install path is not writable. Update it yourself with: ${command.display}`;
    }
    return `This installation is not managed by a global ${method} install. Update it with the package manager, wrapper, or source checkout that provides it.`;
  }
  return `Update ${target.installSpec} using the package manager, wrapper, or source checkout that provides this installation.`;
}

const getSelfUpdateUnavailableInstruction: {
  (
    packageName: string,
    npmCommand?: string[],
    updatePackageTarget?: configInstallCommandTypes.SelfUpdatePackageTarget,
  ): string;
  (
    npmCommand?: string[],
    updatePackageTarget?: configInstallCommandTypes.SelfUpdatePackageTarget,
  ): (packageName: string) => string;
} = dual((args: IArguments) => args.length >= 1, getSelfUpdateUnavailableInstructionImpl);

function getUpdateInstruction(packageName: string): string {
  const method = detectInstallMethod();
  const command = getSelfUpdateCommandForMethod(method, packageName);
  if (command !== undefined) {
    return `Run: ${command.display}`;
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
