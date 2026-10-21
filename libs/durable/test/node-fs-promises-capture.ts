import type envNodeSupportTypes from "./env-node-support.types.ts";

type OpenFile = (path: string, flags: string) => Promise<envNodeSupportTypes.NodeFileHandle>;

const captured: { open?: OpenFile } = {};

const captureFsPromises = <T extends { readonly open: unknown }>(actual: T): T => {
  captured.open = actual.open as OpenFile;
  return actual;
};

const openFile: OpenFile = (path, flags) => {
  if (captured.open === undefined) {
    return Promise.reject(new Error("node:fs/promises was not mocked through captureFsPromises"));
  }
  return captured.open(path, flags);
};

const nodeFsPromisesCapture = { captureFsPromises, openFile };

export default nodeFsPromisesCapture;
