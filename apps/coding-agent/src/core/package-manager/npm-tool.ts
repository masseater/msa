import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import platformNode from "../platform-node.ts";
import commandRunner from "./command-runner.ts";

const { basename, dirname, join } = platformNode;
const { awaited, awaitingWith } = awaitingModule;

export default class NpmTool {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  private globalNpmRoot!: string | undefined;

  private globalNpmRootCommandKey!: string | undefined;

  getNpmCommand(): { command: string; args: string[] } {
    const configuredCommand = this.manager.settingsManager.getNpmCommand();
    if (configuredCommand === undefined || configuredCommand.length === 0) {
      return { args: [], command: "npm" };
    }
    const [command, ...args] = configuredCommand;
    if (command === undefined || command === "") {
      throw new Error("Invalid npmCommand: first array entry must be a non-empty command");
    }
    return { args, command };
  }

  getPackageManagerName(): string {
    const npmCommand = this.getNpmCommand();
    const normalizeCommandName = (command: string): string =>
      basename(command).replace(/\.(cmd|exe)$/iu, "");
    const supportedPackageManagers = new Set(["npm", "pnpm", "bun"]);
    const directCommand = normalizeCommandName(npmCommand.command);
    const separatorIndex = npmCommand.args.lastIndexOf("--");
    if (separatorIndex >= 0) {
      const wrappedCommand = npmCommand.args[separatorIndex + 1];
      return wrappedCommand !== undefined && wrappedCommand !== ""
        ? normalizeCommandName(wrappedCommand)
        : directCommand;
    }
    if (supportedPackageManagers.has(directCommand)) return directCommand;

    const wrappedPackageManagers = [
      ...new Set(
        npmCommand.args
          .map(normalizeCommandName)
          .filter((command) => supportedPackageManagers.has(command)),
      ),
    ];
    if (wrappedPackageManagers.length > 1) {
      throw new Error(
        `Ambiguous npmCommand package managers: ${wrappedPackageManagers.join(", ")}`,
      );
    }
    return wrappedPackageManagers[0] ?? directCommand;
  }

  getGitDependencyInstallArgs(): string[] {
    switch (this.getPackageManagerName()) {
      case "bun":
        return ["install", "--omit=dev", "--omit=peer"];
      case "pnpm":
        return [
          "install",
          "--prod",
          "--config.auto-install-peers=false",
          "--config.strict-peer-dependencies=false",
          "--config.strict-dep-builds=false",
        ];
      case "npm":
        return ["install", "--omit=dev", "--legacy-peer-deps"];
      default:
        return ["install"];
    }
  }

  getNpmInstallArgs(specs: string[], installRoot: string): string[] {
    const packageManagerName = this.getPackageManagerName();
    if (packageManagerName === "bun") {
      return ["install", ...specs, "--cwd", installRoot, "--omit=peer"];
    }
    if (packageManagerName === "pnpm") {
      return [
        "install",
        ...specs,
        "--prefix",
        installRoot,
        "--config.auto-install-peers=false",
        "--config.strict-peer-dependencies=false",
        "--config.strict-dep-builds=false",
      ];
    }
    return ["install", ...specs, "--prefix", installRoot, "--legacy-peer-deps"];
  }

  private runNpmCommandSync(args: string[]): string {
    const npmCommand = this.getNpmCommand();
    return commandRunner.runCommandSync(npmCommand.command, [...npmCommand.args, ...args]);
  }

  getGlobalNpmRoot(): string {
    const npmCommand = this.getNpmCommand();
    const commandKey = [npmCommand.command, ...npmCommand.args].join("\0");
    if (
      this.globalNpmRoot !== undefined &&
      this.globalNpmRoot !== "" &&
      this.globalNpmRootCommandKey === commandKey
    ) {
      return this.globalNpmRoot;
    }
    if (this.getPackageManagerName() === "bun") {
      const binDir = this.runNpmCommandSync(["pm", "bin", "-g"]).trim();
      this.globalNpmRoot = join(dirname(binDir), "install", "global", "node_modules");
    } else {
      this.globalNpmRoot = this.runNpmCommandSync(["root", "-g"]).trim();
    }
    this.globalNpmRootCommandKey = commandKey;
    return this.globalNpmRoot;
  }

  getPnpmGlobalPackagePath(packageName: string): string | undefined {
    if (this.getPackageManagerName() !== "pnpm") {
      return undefined;
    }

    const output = this.runNpmCommandSync(["list", "-g", "--depth", "0", "--json"]);
    const entries = JSON.parse(output) as Array<{
      dependencies?: Record<string, { path?: string }>;
    }>;
    for (const entry of entries) {
      const path = entry.dependencies?.[packageName]?.path;
      if (path !== undefined && path !== "") return path;
    }
    return undefined;
  }

  runNpmCommand(args: string[], options?: { cwd?: string }): Effect.Effect<void> {
    return awaitingWith(function* () {
      const npmCommand = this.getNpmCommand();
      yield* awaited(
        commandRunner.runCommand(npmCommand.command, [...npmCommand.args, ...args], options),
      );
    }, this);
  }
}
