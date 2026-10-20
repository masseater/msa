import type { ExtensionAPI } from "@msa/coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@msa/coding-agent";

import { toolRenderers } from "./minimal-mode-render.ts";

const createBuiltInTools = (cwd: string) => ({
  bash: createBashToolDefinition(cwd),
  edit: createEditToolDefinition(cwd),
  find: createFindToolDefinition(cwd),
  grep: createGrepToolDefinition(cwd),
  ls: createLsToolDefinition(cwd),
  read: createReadToolDefinition(cwd),
  write: createWriteToolDefinition(cwd),
});

export default function (msa: ExtensionAPI) {
  const tools = createBuiltInTools(process.cwd());

  msa.registerTool({ ...tools.read, ...toolRenderers.read });
  msa.registerTool({ ...tools.bash, ...toolRenderers.bash });
  msa.registerTool({ ...tools.write, ...toolRenderers.write });
  msa.registerTool({ ...tools.edit, ...toolRenderers.edit });
  msa.registerTool({ ...tools.find, ...toolRenderers.find });
  msa.registerTool({ ...tools.grep, ...toolRenderers.grep });
  msa.registerTool({ ...tools.ls, ...toolRenderers.ls });
}
