import chalk from "chalk";

import text from "../utils/text.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platform from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";
import sourceInfoModule from "./source-info.ts";

const { join, writeError } = platform;
const { existsSync, readFileSync } = nodeFs;
const { stripBom } = text;
const { BUILTIN_PATH_PREFIX } = sourceInfoModule;

const HOST_PROVIDED_EXTENSION_PACKAGES = new Set([
  "@msa/agent-core",
  "@msa/ai",
  "@msa/coding-agent",
  "@msa/tui",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
  "typebox",
]);

function collectExtensionPackageWarnings(
  extensionPaths: string[],
  metadataByPath: Map<string, packageManagerTypes.PathMetadata>,
): Array<{ path: string; warning: string }> {
  const warnings: Array<{ path: string; warning: string }> = [];
  const packageRoots = new Set(
    extensionPaths
      .map((extensionPath) => metadataByPath.get(extensionPath)?.packageRoot)
      .filter((packageRoot): packageRoot is string => packageRoot !== undefined),
  );
  for (const packageRoot of packageRoots) {
    const packageJsonPath = join(packageRoot, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    const manifest = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8"))) as {
      dependencies?: unknown;
    };
    if (
      typeof manifest.dependencies !== "object" ||
      manifest.dependencies === null ||
      Array.isArray(manifest.dependencies)
    ) {
      continue;
    }
    const hostDependencies = Object.keys(manifest.dependencies)
      .filter((name) => HOST_PROVIDED_EXTENSION_PACKAGES.has(name))
      .sort();
    if (hostDependencies.length === 0) continue;
    warnings.push({
      path: packageJsonPath,
      warning: `Host-provided extension packages must be declared in peerDependencies with a "*" range, not dependencies: ${hostDependencies.join(", ")}. Installed copies can bypass the extension loader and create duplicate runtime modules.`,
    });
  }
  return warnings;
}

function mergeExtensionWarnings(
  result: extensionsTypesTypes.LoadExtensionsResult,
  warnings: Array<{ path: string; warning: string }>,
): void {
  result.warnings = [
    ...new Map(
      [...(result.warnings ?? []), ...warnings].map((warning) => [warning.path, warning]),
    ).values(),
  ];
}

function omitReplacedExtensions(
  extensions: extensionsTypesTypes.Extension[],
  warnings?: Array<{ path: string; warning: string }>,
): extensionsTypesTypes.Extension[] {
  const names = (extension: extensionsTypesTypes.Extension) => [
    ...[...extension.tools.keys()].map((name) => `tool:${name}`),
    ...[...extension.commands.keys()].map((name) => `command:${name}`),
    ...[...extension.flags.keys()].map((name) => `flag:${name}`),
  ];
  const taken = new Map(
    extensions
      .filter((extension) => extension.replaceable !== true)
      .flatMap((extension) => names(extension).map((name) => [name, extension] as const)),
  );
  return extensions.filter((extension) => {
    if (extension.replaceable !== true) return true;
    const replacement = names(extension)
      .map((name) => ({ extension: taken.get(name), name }))
      .find(
        (value): value is { name: string; extension: extensionsTypesTypes.Extension } =>
          value.extension !== undefined,
      );
    if (replacement === undefined) return true;
    if (extension.path.startsWith(BUILTIN_PATH_PREFIX)) {
      const builtinName = extension.path.slice(BUILTIN_PATH_PREFIX.length);
      const [kind, rawName] = replacement.name.split(":", 2);
      const registeredName =
        kind === "command" ? `/${rawName}` : kind === "flag" ? `--${rawName}` : rawName;
      warnings?.push({
        path: extension.path,
        warning: `Extension ${replacement.extension.path} registers ${kind} \`${registeredName}\`, so built-in extension \`${builtinName}\` was not loaded. To use \`${builtinName}\`, run \`msa config\` and make sure it is enabled under Built-in extensions, then disable or remove the existing extension. We recommend only having one or the other loaded at a time.`,
      });
    }
    return false;
  });
}

function resolvePromptInput(input: string | undefined, description: string): string | undefined {
  if (input === undefined || input === "") {
    return undefined;
  }

  if (existsSync(input)) {
    try {
      return stripBom(readFileSync(input, "utf-8"));
    } catch (error) {
      writeError(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
      return input;
    }
  }

  return input;
}

const defaultResourceLoaderHelpers = {
  HOST_PROVIDED_EXTENSION_PACKAGES,
  collectExtensionPackageWarnings,
  mergeExtensionWarnings,
  omitReplacedExtensions,
  resolvePromptInput,
};

export default defaultResourceLoaderHelpers;
