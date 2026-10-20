import { getPackageDir, isBunBinary, isBunRuntime, moduleDirname } from "./config-package.ts";
import { basename, dirname } from "./core/platform-node.ts";
import { readEnv } from "./core/platform.ts";
import { spawnProcessSync } from "./utils/child-process.ts";
import { windowsBasename, windowsDirname } from "./utils/platform-extra.ts";

export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

interface SelfUpdateCommandStep {
  command: string;
  args: string[];
  display: string;
}

export interface SelfUpdateCommand extends SelfUpdateCommandStep {
  steps?: SelfUpdateCommandStep[];
}

export type SelfUpdatePackageTarget = string | { packageName: string; installSpec?: string };

export function normalizeSelfUpdatePackageTarget(target: SelfUpdatePackageTarget): {
  packageName: string;
  installSpec: string;
} {
  if (typeof target === "string") {
    return { installSpec: target, packageName: target };
  }
  return { installSpec: target.installSpec ?? target.packageName, packageName: target.packageName };
}

export function makeSelfUpdateCommand(
  installStep: SelfUpdateCommandStep,
  uninstallStep?: SelfUpdateCommandStep,
): SelfUpdateCommand {
  if (uninstallStep === undefined) return installStep;
  return {
    ...installStep,
    display: `${uninstallStep.display} && ${installStep.display}`,
    steps: [uninstallStep, installStep],
  };
}

export function makeSelfUpdateCommandStep(command: string, args: string[]): SelfUpdateCommandStep {
  return {
    args,
    command,
    display: [command, ...args].map((arg) => (/\s/u.test(arg) ? `"${arg}"` : arg)).join(" "),
  };
}

export function detectInstallMethod(): InstallMethod {
  if (isBunBinary) {
    return "bun-binary";
  }

  const resolvedPath = `${moduleDirname}\0${process.execPath || ""}`
    .toLowerCase()
    .replace(/\\/gu, "/");

  if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/")) {
    return "pnpm";
  }
  if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/")) {
    return "yarn";
  }
  if (isBunRuntime || resolvedPath.includes("/install/global/node_modules/")) {
    return "bun";
  }
  if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/")) {
    return "npm";
  }

  return "unknown";
}

export function getInferredNpmInstall(): { root: string; prefix: string } | undefined {
  const packageDir = getPackageDir();
  const path =
    process.platform === "win32" || packageDir.includes("\\")
      ? { basename: windowsBasename, dirname: windowsDirname }
      : { basename, dirname };
  const parent = path.dirname(packageDir);
  let root: string | undefined;
  if (
    path.basename(parent).startsWith("@") &&
    path.basename(path.dirname(parent)) === "node_modules"
  ) {
    root = path.dirname(parent);
  } else if (path.basename(parent) === "node_modules") {
    root = parent;
  }
  if (root === undefined || root === "") return undefined;
  const rootParent = path.dirname(root);
  if (path.basename(rootParent) === "lib") return { prefix: path.dirname(rootParent), root };

  return undefined;
}

export function getSelfUpdateCommandForMethod(
  method: InstallMethod,
  installedPackageName: string,
  updatePackageTarget: SelfUpdatePackageTarget = installedPackageName,
  npmCommand?: string[],
): SelfUpdateCommand | undefined {
  const target = normalizeSelfUpdatePackageTarget(updatePackageTarget);
  switch (method) {
    case "bun-binary":
      return undefined;
    case "pnpm": {
      const globalRoot = readCommandOutput("pnpm", ["root", "-g"]);
      const match =
        globalRoot !== undefined && globalRoot !== ""
          ? undefined
          : /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/u.exec(getPackageDir());
      const globalDir = match?.[1];
      const binDirArgs =
        globalDir === undefined
          ? []
          : [`--config.global-bin-dir=${readEnv("PNPM_HOME") || dirname(dirname(globalDir))}`];
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("pnpm", [
          "install",
          "-g",
          "--ignore-scripts",
          "--config.minimumReleaseAge=0",
          ...binDirArgs,
          target.installSpec,
        ]),
        target.packageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("pnpm", [
              "remove",
              "-g",
              ...binDirArgs,
              installedPackageName,
            ]),
      );
    }
    case "yarn":
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("yarn", [
          "global",
          "add",
          "--ignore-scripts",
          target.installSpec,
        ]),
        target.packageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("yarn", ["global", "remove", installedPackageName]),
      );
    case "bun":
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("bun", [
          "install",
          "-g",
          "--ignore-scripts",
          "--minimum-release-age=0",
          target.installSpec,
        ]),
        target.packageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("bun", ["uninstall", "-g", installedPackageName]),
      );
    case "npm": {
      const [command = "npm", ...npmArgs] = npmCommand ?? [];
      const inferred =
        npmCommand?.length !== undefined && npmCommand?.length !== 0
          ? undefined
          : getInferredNpmInstall();
      const prefixArgs = [
        ...npmArgs,
        ...(inferred === undefined ? [] : ["--prefix", inferred.prefix]),
      ];

      const installStep = makeSelfUpdateCommandStep(command, [
        ...prefixArgs,
        "install",
        "-g",
        "--ignore-scripts",
        "--min-release-age=0",
        target.installSpec,
      ]);
      const uninstallStep =
        target.packageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep(command, [
              ...prefixArgs,
              "uninstall",
              "-g",
              installedPackageName,
            ]);
      return makeSelfUpdateCommand(installStep, uninstallStep);
    }
    case "unknown":
      return undefined;
  }
}

export function readCommandOutput(
  command: string,
  args: string[],
  options: { requireSuccess?: boolean } = {},
): string | undefined {
  const result = spawnProcessSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return result.stdout.trim() || undefined;
  if (options.requireSuccess === true) {
    const reason =
      result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
    throw new Error(`Failed to run ${[command, ...args].join(" ")}: ${reason}`);
  }
  return undefined;
}
