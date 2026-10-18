

import type { ExtensionAPI } from "@msa/coding-agent";
import { createBashTool } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  const cwd = process.cwd();

  const bashTool = createBashTool(cwd, {
    spawnHook: ({ command, cwd: spawnCwd, env }) => ({
      command: `source ~/.profile\n${command}`,
      cwd: spawnCwd,
      env: { ...env, MSA_SPAWN_HOOK: "1" },
    }),
  });

  msa.registerTool({
    ...bashTool,
    execute: (id, params, signal, onUpdate) =>
      bashTool.execute(id, params, signal, onUpdate),
  });
}
