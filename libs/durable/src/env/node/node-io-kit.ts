import NodeBinaryReader from "./node-binary-reader.ts";
import NodeDirReader from "./node-dir-reader.ts";
import nodeErrors from "./node-errors.ts";
import nodeFiles from "./node-files.ts";
import nodePaths from "./node-paths.ts";
import NodeTextLineReader from "./node-text-reader.ts";

const nodeIoKit = {
  NodeBinaryReader,
  NodeDirReader,
  NodeTextLineReader,
  nodeErrors,
  nodeFiles,
  nodePaths,
};

export default nodeIoKit;
