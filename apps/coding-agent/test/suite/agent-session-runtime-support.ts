import type srcTypes from "../../src/index.types.ts";
import runtimeKit from "../runtime-kit.ts";

const { createFauxRuntime, disposeRuntimes } = runtimeKit;

const createRuntimeForTest = (
  extensionFactory: srcTypes.ExtensionFactory = () => {},
  options: { cwd?: string; bootstrapModel?: boolean } = {},
) =>
  createFauxRuntime({
    ...options,
    extensionFactory,
    models: [
      { id: "faux-1", reasoning: true },
      { id: "faux-2", reasoning: false },
    ],
  });

const agentSessionRuntimeSupport = {
  createRuntimeForTest,
  disposeRuntimes,
};

export default agentSessionRuntimeSupport;
