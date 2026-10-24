import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import platformEnv from "../env.ts";

const { readEnv } = platformEnv;

type NodeLlamaCpp = typeof import("node-llama-cpp");

const BINDING_TEST_SCRIPT = "testBindingBinary";

const importNodeLlamaCppAt = (entry: string): Promise<NodeLlamaCpp> =>
  import(pathToFileURL(entry).href);

const bindingTestScript = (argv: readonly string[]): string | undefined => {
  const script = argv[0];
  return readEnv("TEST_BINDING_CP") === "true" &&
    process.send !== undefined &&
    script !== undefined &&
    basename(script).startsWith(BINDING_TEST_SCRIPT)
    ? script
    : undefined;
};

const runBindingTest = (script: string): Promise<unknown> => import(pathToFileURL(script).href);

const nodeLlamaCpp = { bindingTestScript, importNodeLlamaCppAt, runBindingTest };

export default nodeLlamaCpp;
