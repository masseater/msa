import { pathToFileURL } from "node:url";

type NodeLlamaCpp = typeof import("node-llama-cpp");

const importNodeLlamaCppAt = (entry: string): Promise<NodeLlamaCpp> =>
  import(pathToFileURL(entry).href);

const nodeLlamaCpp = { importNodeLlamaCppAt };

export default nodeLlamaCpp;
