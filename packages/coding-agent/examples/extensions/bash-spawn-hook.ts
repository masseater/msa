/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   msa -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@msa/coding-agent";
import { createBashTool } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  const cwd = process.cwd();

  const bashTool = createBashTool(cwd, {
    spawnHook: ({ command, cwd, env }) => ({
      command: `source ~/.profile\n${command}`,
      cwd,
      env: { ...env, MSA_SPAWN_HOOK: "1" },
    }),
  });

  msa.registerTool({
    ...bashTool,
    execute: async (id, params, signal, onUpdate, _ctx) => {
      return bashTool.execute(id, params, signal, onUpdate);
    },
  });
}
