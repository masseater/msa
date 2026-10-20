import config from "../config.ts";
import text from "../utils/text.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer0 from "./default-package-manager-layer-0.ts";
import packageManager from "./package-manager.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { basename, dirname, join, resolve, sep, sha256Hex } = platformNode;
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = nodeFs;
const { stripBom } = text;
const { CONFIG_DIR_NAME } = config;
const { getExtensionTempFolder } = packageManager;

export default abstract class DefaultPackageManagerLayer1 extends DefaultPackageManagerLayer0 {
  setProgressCallback(callback: packageManagerTypes.ProgressCallback | undefined): void {
    this.progressCallback = callback;
  }

  protected emitProgress(event: packageManagerTypes.ProgressEvent): void {
    this.progressCallback?.(event);
  }

  protected getPackageSourceString(pkg: settingsManagerTypes.PackageSource): string {
    return typeof pkg === "string" ? pkg : pkg.source;
  }

  protected getInstalledNpmVersion(installedPath: string): string | undefined {
    const packageJsonPath = join(installedPath, "package.json");
    if (!existsSync(packageJsonPath)) return undefined;
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(stripBom(content)) as { version?: string };
      return pkg.version;
    } catch {
      return undefined;
    }
  }

  protected parseNpmSpec(spec: string): { name: string; version?: string } {
    const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/u);
    if (match === null) {
      return { name: spec };
    }
    const name = match[1] ?? spec;
    const version = match[2];
    return version === undefined ? { name } : { name, version };
  }

  protected assertProjectTrustedForScope(scope: packageManagerTypes.SourceScope): void {
    if (scope === "project" && !this.settingsManager.isProjectTrusted()) {
      throw new Error("Project is not trusted; refusing to access project package storage");
    }
  }

  protected getNpmCommand(): { command: string; args: string[] } {
    const configuredCommand = this.settingsManager.getNpmCommand();
    if (configuredCommand === undefined || configuredCommand.length === 0) {
      return { args: [], command: "npm" };
    }
    const [command, ...args] = configuredCommand;
    if (command === undefined || command === "") {
      throw new Error("Invalid npmCommand: first array entry must be a non-empty command");
    }
    return { args, command };
  }

  protected getPackageManagerName(): string {
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

  protected getGitDependencyInstallArgs(): string[] {
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

  protected getNpmInstallArgs(specs: string[], installRoot: string): string[] {
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

  protected getGitUpdateMarkerPath(targetDir: string): string {
    return join(dirname(targetDir), `.${basename(targetDir)}.msa-update-incomplete`);
  }

  protected pruneEmptyGitParents(targetDir: string, installRoot: string | undefined): void {
    if (installRoot === undefined || installRoot === "") return;
    const resolvedRoot = resolve(installRoot);
    let current = dirname(targetDir);
    while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
      if (!existsSync(current)) {
        current = dirname(current);
        continue;
      }
      const entries = readdirSync(current);
      if (entries.length > 0) {
        break;
      }
      try {
        rmSync(current, { force: true, recursive: true });
      } catch {
        break;
      }
      current = dirname(current);
    }
  }

  protected ensureGitIgnore(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const ignorePath = join(dir, ".gitignore");
    if (!existsSync(ignorePath)) {
      writeFileSync(ignorePath, "*\n!.gitignore\n", "utf-8");
    }
  }

  protected getNpmInstallRoot(scope: packageManagerTypes.SourceScope, temporary: boolean): string {
    if (temporary) {
      return this.getTemporaryDir("npm");
    }
    if (scope === "project") {
      this.assertProjectTrustedForScope(scope);
      return join(this.cwd, CONFIG_DIR_NAME, "npm");
    }
    return join(this.agentDir, "npm");
  }

  protected getManagedNpmInstallPath(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: packageManagerTypes.SourceScope,
  ): string {
    if (scope === "temporary") {
      return join(this.getTemporaryDir("npm"), "node_modules", source.name);
    }
    if (scope === "project") {
      this.assertProjectTrustedForScope(scope);
      return join(this.cwd, CONFIG_DIR_NAME, "npm", "node_modules", source.name);
    }
    return join(this.agentDir, "npm", "node_modules", source.name);
  }

  protected getGitInstallRoot(scope: packageManagerTypes.SourceScope): string | undefined {
    if (scope === "temporary") {
      return undefined;
    }
    if (scope === "project") {
      this.assertProjectTrustedForScope(scope);
      return join(this.cwd, CONFIG_DIR_NAME, "git");
    }
    return join(this.agentDir, "git");
  }

  protected getTemporaryDir(prefix: string, suffix?: string, ref?: string): string {
    const root = this.resolveManagedPath(getExtensionTempFolder(this.agentDir), prefix);
    const hash = sha256Hex(
      `${prefix}-${suffix ?? ""}${ref !== undefined && ref !== "" ? `@${ref}` : ""}`,
    ).slice(0, 8);
    return this.resolveManagedPath(root, hash, suffix ?? "");
  }

  protected resolveManagedPath(root: string, ...parts: string[]): string {
    const resolvedRoot = resolve(root);
    const resolvedPath = resolve(resolvedRoot, ...parts);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
      throw new Error(`Refusing to use path outside package install root: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  protected getBaseDirForScope(scope: packageManagerTypes.SourceScope): string {
    if (scope === "project") {
      this.assertProjectTrustedForScope(scope);
      return join(this.cwd, CONFIG_DIR_NAME);
    }
    if (scope === "user") {
      return this.agentDir;
    }
    return this.cwd;
  }

  protected getTargetMap(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }> {
    switch (resourceType) {
      case "extensions":
        return accumulator.extensions;
      case "skills":
        return accumulator.skills;
      case "prompts":
        return accumulator.prompts;
      case "themes":
        return accumulator.themes;
      default:
        throw new Error(`Unknown resource type: ${resourceType}`);
    }
  }

  protected addResource(
    map: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    path: string,
    metadata: packageManagerTypes.PathMetadata,
    enabled: boolean,
  ): void {
    if (path === "") return;
    if (!map.has(path)) {
      map.set(path, { enabled, metadata });
    }
  }

  protected createAccumulator(): defaultPackageManagerInternalTypes.ResourceAccumulator {
    return {
      extensions: new Map(),
      prompts: new Map(),
      skills: new Map(),
      themes: new Map(),
    };
  }
}
