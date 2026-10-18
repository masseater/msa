import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import type { createJiti } from "jiti";

import { isBunBinary, isBundledNode } from "../../config.ts";
import { fromPromise, pathOperations } from "../platform/index.ts";
import { pathExists } from "../tools/path-utils.ts";
import { extensionCache, type ExtensionCacheToken, isCurrentCacheToken } from "./loader-cache.ts";
import type { ExtensionFactory } from "./types.ts";

const require = createRequire(import.meta.url);

const isNodeSeaBinary =
  ("sea" in process.features && process.features.sea === true) ||
  process.getBuiltinModule("node:sea")?.isSea() === true;
const isTypeScriptSourceRuntime =
  !isBunBinary && pathOperations.extname(fileURLToPath(import.meta.url)) === ".ts";
const usesEmbeddedModules = isBunBinary || isNodeSeaBinary || isBundledNode;

let createJitiPromise: Promise<typeof createJiti> | undefined;

function getCreateJiti(): Promise<typeof createJiti> {
  createJitiPromise ??= (
    usesEmbeddedModules ? import("./jiti-static-loader.ts") : import("./jiti-loader.ts")
  ).then((module) => module.createJiti);
  return createJitiPromise;
}

let virtualModulesPromise: Promise<Record<string, unknown>> | undefined;

function getVirtualModules(): Promise<Record<string, unknown>> {
  virtualModulesPromise ??= import("./virtual-modules.ts").then((module) => module.VIRTUAL_MODULES);
  return virtualModulesPromise;
}

let cachedAliases: Record<string, string> | undefined;

const resolveWorkspaceOrImport = (packagesRoot: string, relativePath: string, specifier: string) =>
  Effect.gen(function* () {
    const workspacePath = pathOperations.join(packagesRoot, relativePath);
    const exists = yield* fromPromise(() => pathExists(workspacePath));
    return exists ? workspacePath : fileURLToPath(import.meta.resolve(specifier));
  });

const buildAliases = Effect.gen(function* () {
  const here = pathOperations.dirname(fileURLToPath(import.meta.url));
  const packagesRoot = pathOperations.resolve(here, "../../../../");
  const resolveEntry = (relativePath: string, specifier: string) =>
    resolveWorkspaceOrImport(packagesRoot, relativePath, specifier);
  const msaCodingAgentEntry = pathOperations.resolve(here, "../..", "index.js");
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
    "@msa/coding-agent": msaCodingAgentEntry,
    "@msa/agent-core": msaAgentCoreEntry,
    "@msa/tui": msaTuiEntry,
    "@msa/ai/providers/all": msaAiProvidersEntry,
    "@msa/ai/compat": msaAiCompatEntry,
    "@msa/ai/oauth": msaAiOauthEntry,
    "@msa/ai": msaAiCompatEntry,
    "@mariozechner/pi-coding-agent": msaCodingAgentEntry,
    "@mariozechner/pi-agent-core": msaAgentCoreEntry,
    "@mariozechner/pi-tui": msaTuiEntry,
    "@mariozechner/pi-ai/providers/all": msaAiProvidersEntry,
    "@mariozechner/pi-ai/compat": msaAiCompatEntry,
    "@mariozechner/pi-ai/oauth": msaAiOauthEntry,
    "@mariozechner/pi-ai": msaAiCompatEntry,
    typebox: typeboxEntry,
    "typebox/compile": typeboxCompileEntry,
    "typebox/value": typeboxValueEntry,
    "@sinclair/typebox": typeboxEntry,
    "@sinclair/typebox/compile": typeboxCompileEntry,
    "@sinclair/typebox/value": typeboxValueEntry,
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
    return { virtualModules: yield* fromPromise(() => getVirtualModules()), tryNative: false };
  }
  if (isTypeScriptSourceRuntime) {
    return { virtualModules: yield* fromPromise(() => getVirtualModules()), tsconfigPaths: true };
  }
  return { alias: yield* aliases };
});

export const loadExtensionModule = Effect.fn("loadExtensionModule")(function* (input: {
  extensionPath: string;
  cacheToken?: ExtensionCacheToken | undefined;
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
  const factory = module as ExtensionFactory;
  if (typeof factory !== "function") return undefined;
  if (isCurrentCacheToken(cacheToken)) extensionCache.set(extensionPath, factory);
  return factory;
});
