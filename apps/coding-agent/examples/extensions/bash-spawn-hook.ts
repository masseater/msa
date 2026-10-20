import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";

const { createBashTool } = codingAgent;

export default function (msa: codingAgentTypes.ExtensionAPI) {
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
    execute: (id, params, signal, onUpdate) => bashTool.execute(id, params, signal, onUpdate),
  });
}
