import errors from "../utils/errors.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import type extensionTypes from "./extensions/types-extension.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";

const { toErrorMessage } = errors;

type Diagnostic = agentSessionServicesTypes.AgentSessionRuntimeDiagnostic;
type ExtensionsResult = extensionTypes.LoadExtensionsResult;

function drain<T extends { extensionPath: string }>(
  pending: readonly T[],
  register: (entry: T) => void,
): Diagnostic[] {
  return pending.flatMap((entry) => {
    try {
      register(entry);
      return [];
    } catch (error) {
      const message = toErrorMessage(error);
      return [{ message: `Extension "${entry.extensionPath}" error: ${message}`, type: "error" }];
    }
  });
}

function registerPendingProviders(
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  extensionsResult: ExtensionsResult,
): Diagnostic[] {
  const { runtime } = extensionsResult;
  const diagnostics = drain(runtime.pendingProviderRegistrations, ({ name, config }) =>
    modelRuntime.registerProvider(name, config),
  );
  runtime.pendingProviderRegistrations = [];
  return diagnostics;
}

function registerPendingModels(
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  extensionsResult: ExtensionsResult,
): Diagnostic[] {
  const { runtime } = extensionsResult;
  const native = drain(runtime.pendingNativeProviderRegistrations, ({ provider }) =>
    modelRuntime.registerNativeProvider(provider),
  );
  runtime.pendingNativeProviderRegistrations = [];
  const virtual = drain(runtime.pendingVirtualModelRegistrations, ({ definition }) =>
    modelRuntime.registerVirtualModel(definition),
  );
  runtime.pendingVirtualModelRegistrations = [];
  return [...native, ...virtual];
}

function registeredFlagTypes(extensionsResult: ExtensionsResult) {
  const registeredFlags = new Map<string, "boolean" | "string">();
  for (const extension of extensionsResult.extensions) {
    for (const [name, flag] of extension.flags) registeredFlags.set(name, flag.type);
  }
  return registeredFlags;
}

function applyExtensionFlagValues(
  resourceLoader: resourceLoaderTypes.ResourceLoader,
  extensionFlagValues: Map<string, boolean | string> | undefined,
): Diagnostic[] {
  if (extensionFlagValues === undefined) return [];
  const diagnostics: Diagnostic[] = [];
  const extensionsResult = resourceLoader.getExtensions();
  const registeredFlags = registeredFlagTypes(extensionsResult);
  const unknownFlags: string[] = [];
  for (const [name, value] of extensionFlagValues) {
    const type = registeredFlags.get(name);
    if (type === undefined) {
      unknownFlags.push(name);
    } else if (type === "boolean") {
      extensionsResult.runtime.flagValues.set(name, true);
    } else if (typeof value === "string") {
      extensionsResult.runtime.flagValues.set(name, value);
    } else {
      diagnostics.push({ message: `Extension flag "--${name}" requires a value`, type: "error" });
    }
  }
  if (unknownFlags.length > 0) {
    diagnostics.push({
      message: `Unknown option${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.map((name) => `--${name}`).join(", ")}`,
      type: "error",
    });
  }
  return diagnostics;
}

const extensionRegistrations = {
  applyExtensionFlagValues,
  registerPendingModels,
  registerPendingProviders,
};

export default extensionRegistrations;
