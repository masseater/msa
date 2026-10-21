import platformModule from "../core/platform/index.ts";
import moduleHookFiles from "../core/platform/node/module-hook-files.ts";
import nodeModuleHooks from "../core/platform/node/module-hooks.ts";
import nodeUrl from "../core/platform/node/url.ts";

const { registerHooks } = nodeModuleHooks;
const { fileURLToPath, pathToFileURL } = nodeUrl;

const { firstRegularFileForModuleHook, readTextForModuleHook } = moduleHookFiles;

const { extname, resolve, sep } = platformModule;

interface TsConfig {
  readonly compilerOptions?: {
    readonly paths?: Readonly<Record<string, readonly string[]>>;
  };
}

interface SourceAlias {
  readonly pattern: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly replacements: readonly string[];
}

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const tsconfigPath = resolve(repositoryRoot, "tsconfig.json");
const tsconfig = JSON.parse(readTextForModuleHook(tsconfigPath)) as TsConfig;
const paths = tsconfig.compilerOptions?.paths;
if (paths === undefined)
  throw new Error(`Source runtime requires compilerOptions.paths in ${tsconfigPath}`);

const aliases: SourceAlias[] = Object.entries(paths)
  .filter(([pattern]) => pattern.startsWith("@msa/"))
  .map(([pattern, replacements]) => {
    const wildcard = pattern.indexOf("*");
    if (wildcard !== -1 && pattern.indexOf("*", wildcard + 1) !== -1) {
      throw new Error(`Source runtime does not support multiple wildcards in ${pattern}`);
    }
    return {
      pattern,
      prefix: wildcard === -1 ? pattern : pattern.slice(0, wildcard),
      replacements,
      suffix: wildcard === -1 ? "" : pattern.slice(wildcard + 1),
    };
  })
  .sort((left, right) => right.pattern.length - left.pattern.length);

registerHooks({
  resolve(specifier, context, nextResolve) {
    let matchedPattern: string | undefined;
    for (const alias of aliases) {
      const wildcard = matchAlias(alias, specifier);
      if (wildcard === undefined) continue;
      matchedPattern ??= alias.pattern;
      for (const replacement of alias.replacements) {
        const resolved = resolveSourcePath(replacement.replace("*", wildcard));
        if (resolved !== undefined && resolved !== "")
          return { shortCircuit: true, url: pathToFileURL(resolved).href };
      }
    }
    if (matchedPattern !== undefined && matchedPattern !== "") {
      throw new Error(
        `Source runtime could not resolve ${specifier} through tsconfig path ${matchedPattern}`,
      );
    }
    return nextResolve(specifier, context);
  },
});

function matchAlias(alias: SourceAlias, specifier: string): string | undefined {
  if (!alias.pattern.includes("*")) return specifier === alias.pattern ? "" : undefined;
  if (!specifier.startsWith(alias.prefix) || !specifier.endsWith(alias.suffix)) return undefined;
  return specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length);
}

function resolveSourcePath(replacement: string): string | undefined {
  const basePath = resolve(repositoryRoot, replacement);
  const rootPrefix = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
  if (!basePath.startsWith(rootPrefix)) return undefined;
  const extension = extname(basePath);
  const sourceExtension =
    extension === ".js"
      ? ".ts"
      : extension === ".mjs"
        ? ".mts"
        : extension === ".cjs"
          ? ".cts"
          : undefined;
  const candidates =
    sourceExtension === undefined
      ? extension === ".ts" || extension === ".mts" || extension === ".cts" || extension === ".json"
        ? [basePath]
        : [basePath, `${basePath}.ts`, resolve(basePath, "index.ts")]
      : [basePath, `${basePath.slice(0, -extension.length)}${sourceExtension}`];
  return firstRegularFileForModuleHook(candidates);
}
