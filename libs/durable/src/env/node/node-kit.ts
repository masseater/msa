import nodeErrors from "./node-errors.ts";
import nodeExec from "./node-exec.ts";
import nodeFiles from "./node-files.ts";
import nodeHandles from "./node-handles.ts";
import nodePaths from "./node-paths.ts";
import nodeProcess from "./node-process.ts";
import NodeFileWatcher from "./node-watch.ts";

const nodeKit = {
  NodeFileWatcher,
  nodeErrors,
  nodeExec,
  nodeFiles,
  nodeHandles,
  nodePaths,
  nodeProcess,
};

export default nodeKit;
