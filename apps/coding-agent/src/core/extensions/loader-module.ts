import { Effect } from "effect";
import type { createJiti } from "jiti";

import config from "../../config.ts";
import platform from "../platform/index.ts";
import nodeModule from "../platform/node/module.ts";
import nodeUrl from "../platform/node/url.ts";
import pathUtils from "../tools/path-utils.ts";
import loaderCache from "./loader-cache.ts";
import type loaderCacheTypes from "./loader-cache.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { createRequire } = nodeModule;
const { fileURLToPath } = nodeUrl;

const { isBunBinary, isBundledNode } = config;
const { fromPromise, isSea } = platform;
const { pathExists } = pathUtils;
const { extensionCache, isCurrentCacheToken } = loaderCache;

const require = createRequire(import.meta.url);

const isNodeSeaBinary = ("sea" in process.features && process.features.sea === true) || isSea();
const isTypeScriptSourceRuntime =
  !isBunBinary && platform.extname(fileURLToPath(import.meta.url)) === ".ts";
const usesEmbeddedModules = isBunBinary || isNodeSeaBinary || isBundledNode;

let createJitiPromise: Promise<typeof createJiti> | undefined;

function getCreateJiti(): Promise<typeof createJiti> {
  createJitiPromise ??= (
    usesEmbeddedModules ? import("./jiti-static-loader.ts") : import("./jiti-loader.ts")
  ).then((module) => module.default.createJiti);
  return createJitiPromise;
}

let virtualModulesPromise: Promise<Record<string, unknown>> | undefined;

function getVirtualModules(): Promise<Record<string, unknown>> {
  virtualModulesPromise ??= import("./virtual-modules.ts").then(
    (module) => module.default.VIRTUAL_MODULES,
  );
  return virtualModulesPromise;
}

let cachedAliases: Record<string, string> | undefined;

const resolveWorkspaceOrImport = (packagesRoot: string, relativePath: string, specifier: string) =>
  Effect.gen(function* () {
    const workspacePath = platform.join(packagesRoot, relativePath);
    const exists = yield* fromPromise(() => pathExists(workspacePath));
    return exists ? workspacePath : fileURLToPath(import.meta.resolve(specifier));
  });

const buildAliases = Effect.gen(function* () {
  const here = platform.dirname(fileURLToPath(import.meta.url));
  const packagesRoot = platform.resolve(here, "../../../../");
  const resolveEntry = (relativePath: string, specifier: string) =>
    resolveWorkspaceOrImport(packagesRoot, relativePath, specifier);
  const msaCodingAgentEntry = platform.resolve(here, "../..", "index.js");
  const msaAgentCoreEntry = yield* resolveEntry("agent/dist/index.js", "@msa/agent-core");
  const msaTuiEntry = yield* resolveEntry("tui/dist/index.js", "@msa/tui");
  const msaAiCompatEntry = yield* resolveEntry("ai/dist/compat.js", "@msa/ai/compat");
  const msaAiOauthEntry = yield* resolveEntry("ai/dist/oauth.js", "@msa/ai/oauth");
  const msaAiProvidersEntry = yield* resolveEntry(
    "ai/dist/providers/all.js",
    "@msa/ai/providers/all",
  );
  const typeboxEntry = require.resolve("typebox");
  const typeboxCompileEntry = require.resolve("typebox/compile");
  const typeboxValueEntry = require.resolve("typebox/value");
  return {
    "@mariozechner/pi-agent-core": msaAgentCoreEntry,
    "@mariozechner/pi-ai": msaAiCompatEntry,
    "@mariozechner/pi-ai/compat": msaAiCompatEntry,
    "@mariozechner/pi-ai/oauth": msaAiOauthEntry,
    "@mariozechner/pi-ai/providers/all": msaAiProvidersEntry,
    "@mariozechner/pi-coding-agent": msaCodingAgentEntry,
    "@mariozechner/pi-tui": msaTuiEntry,
    "@msa/agent-core": msaAgentCoreEntry,
    "@msa/ai": msaAiCompatEntry,
    "@msa/ai/compat": msaAiCompatEntry,
    "@msa/ai/oauth": msaAiOauthEntry,
    "@msa/ai/providers/all": msaAiProvidersEntry,
    "@msa/coding-agent": msaCodingAgentEntry,
    "@msa/tui": msaTuiEntry,
    "@sinclair/typebox": typeboxEntry,
    "@sinclair/typebox/compile": typeboxCompileEntry,
    "@sinclair/typebox/value": typeboxValueEntry,
    typebox: typeboxEntry,
    "typebox/compile": typeboxCompileEntry,
    "typebox/value": typeboxValueEntry,
  };
});

const aliases = Effect.suspend(() =>
  cachedAliases === undefined
    ? buildAliases.pipe(
        Effect.tap((built) =>
          Effect.sync(() => {
            cachedAliases = built;
          }),
        ),
      )
    : Effect.succeed(cachedAliases),
);

const resolutionOptions = Effect.gen(function* () {
  if (usesEmbeddedModules) {
    return { tryNative: false, virtualModules: yield* fromPromise(() => getVirtualModules()) };
  }
  if (isTypeScriptSourceRuntime) {
    return { tsconfigPaths: true, virtualModules: yield* fromPromise(() => getVirtualModules()) };
  }
  return { alias: yield* aliases };
});

const loadExtensionModule = Effect.fn("loadExtensionModule")(function* (input: {
  extensionPath: string;
  cacheToken?: loaderCacheTypes.ExtensionCacheToken | undefined;
}) {
  const { extensionPath, cacheToken } = input;
  if (isCurrentCacheToken(cacheToken)) {
    const cachedFactory = extensionCache.get(extensionPath);
    if (cachedFactory !== undefined) return cachedFactory;
  }
  const createJitiImpl = yield* fromPromise(() => getCreateJiti());
  const options = yield* resolutionOptions;
  const jiti = createJitiImpl(import.meta.url, { moduleCache: false, ...options });
  const module = yield* fromPromise(() => jiti.import(extensionPath, { default: true }));
  const factory = module as extensionsTypesTypes.ExtensionFactory;
  if (typeof factory !== "function") return undefined;
  if (isCurrentCacheToken(cacheToken)) extensionCache.set(extensionPath, factory);
  return factory;
});

const loaderModule = {
  loadExtensionModule,
};

export default loaderModule;
