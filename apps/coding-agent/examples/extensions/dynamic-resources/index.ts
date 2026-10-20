import { fileURLToPath } from "node:url";

import type codingAgentTypes from "@msa/coding-agent/index.types";

const baseDir = fileURLToPath(new URL(".", import.meta.url));

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("resources_discover", () => ({
    promptPaths: [`${baseDir}dynamic.md`],
    skillPaths: [`${baseDir}SKILL.md`],
    themePaths: [`${baseDir}dynamic.json`],
  }));
}
