import type configInstallCommandTypes from "./config-install-command.types.ts";
import configPackage from "./config-package.ts";
import platformNode from "./core/platform-node.ts";
import platformModule from "./core/platform.ts";
import childProcess from "./utils/child-process.ts";
import platformExtra from "./utils/platform-extra.ts";

const { getPackageDir, isBunBinary, isBunRuntime, moduleDirname } = configPackage;
const { windowsBasename, windowsDirname } = platformExtra;
const { basename, dirname } = platformNode;
const { readEnv } = platformModule;
const { spawnProcessSync } = childProcess;

function normalizeSelfUpdatePackageTarget(
  target: configInstallCommandTypes.SelfUpdatePackageTarget,
): {
  packageName: string;
  installSpec: string;
} {
  if (typeof target === "string") {
    return { installSpec: target, packageName: target };
  }
  return { installSpec: target.installSpec ?? target.packageName, packageName: target.packageName };
}

function makeSelfUpdateCommand(
  installStep: configInstallCommandTypes.SelfUpdateCommandStep,
  uninstallStep?: configInstallCommandTypes.SelfUpdateCommandStep,
): configInstallCommandTypes.SelfUpdateCommand {
  if (uninstallStep === undefined) return installStep;
  return {
    ...installStep,
    display: `${uninstallStep.display} && ${installStep.display}`,
    steps: [uninstallStep, installStep],
  };
}

function makeSelfUpdateCommandStep(
  command: string,
  args: string[],
): configInstallCommandTypes.SelfUpdateCommandStep {
  return {
    args,
    command,
    display: [command, ...args].map((arg) => (/\s/u.test(arg) ? `"${arg}"` : arg)).join(" "),
  };
}

function detectInstallMethod(): configInstallCommandTypes.InstallMethod {
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

function getInferredNpmInstall(): { root: string; prefix: string } | undefined {
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

function replacingSelfUpdateCommand(
  target: { packageName: string },
  installedPackageName: string,
  installStep: ReturnType<typeof makeSelfUpdateCommandStep>,
  uninstallStep: ReturnType<typeof makeSelfUpdateCommandStep>,
): configInstallCommandTypes.SelfUpdateCommand {
  return makeSelfUpdateCommand(
    installStep,
    target.packageName === installedPackageName ? undefined : uninstallStep,
  );
}

function getSelfUpdateCommandForMethod(
  method: configInstallCommandTypes.InstallMethod,
  installedPackageName: string,
  updatePackageTarget: configInstallCommandTypes.SelfUpdatePackageTarget = installedPackageName,
  npmCommand?: string[],
): configInstallCommandTypes.SelfUpdateCommand | undefined {
  const target = normalizeSelfUpdatePackageTarget(updatePackageTarget);
  switch (method) {
    case "bun-binary":
      return undefined;
    case "pnpm":
      return pnpmSelfUpdateCommand(target, installedPackageName);
    case "yarn":
      return replacingSelfUpdateCommand(
        target,
        installedPackageName,
        makeSelfUpdateCommandStep("yarn", [
          "global",
          "add",
          "--ignore-scripts",
          target.installSpec,
        ]),
        makeSelfUpdateCommandStep("yarn", ["global", "remove", installedPackageName]),
      );
    case "bun":
      return replacingSelfUpdateCommand(
        target,
        installedPackageName,
        makeSelfUpdateCommandStep("bun", [
          "install",
          "-g",
          "--ignore-scripts",
          "--minimum-release-age=0",
          target.installSpec,
        ]),
        makeSelfUpdateCommandStep("bun", ["uninstall", "-g", installedPackageName]),
      );
    case "npm":
      return npmSelfUpdateCommand(npmCommand, target, installedPackageName);
    case "unknown":
      return undefined;
  }
}

function npmSelfUpdateCommand(
  npmCommand: string[] | undefined,
  target: { packageName: string; installSpec: string },
  installedPackageName: string,
): configInstallCommandTypes.SelfUpdateCommand {
  const [command = "npm", ...npmArgs] = npmCommand ?? [];
  const { installStep, uninstallStep } = npmSelfUpdateSteps(
    npmCommand,
    npmArgs,
    command,
    target,
    installedPackageName,
  );
  return makeSelfUpdateCommand(installStep, uninstallStep);
}

function npmSelfUpdateSteps(
  npmCommand: string[] | undefined,
  npmArgs: string[],
  command: string,
  target: { packageName: string; installSpec: string },
  installedPackageName: string,
) {
  const inferred =
    npmCommand?.length !== undefined && npmCommand?.length !== 0
      ? undefined
      : getInferredNpmInstall();
  const prefixArgs = [...npmArgs, ...(inferred === undefined ? [] : ["--prefix", inferred.prefix])];

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
  return { installStep, uninstallStep };
}

function pnpmSelfUpdateCommand(
  target: { packageName: string; installSpec: string },
  installedPackageName: string,
) {
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
      : makeSelfUpdateCommandStep("pnpm", ["remove", "-g", ...binDirArgs, installedPackageName]),
  );
}

function readCommandOutput(
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

const configInstallCommand = {
  detectInstallMethod,
  getInferredNpmInstall,
  getSelfUpdateCommandForMethod,
  makeSelfUpdateCommand,
  makeSelfUpdateCommandStep,
  normalizeSelfUpdatePackageTarget,
  readCommandOutput,
};

export default configInstallCommand;
