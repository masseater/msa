import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@msa/coding-agent";

const baseDir = fileURLToPath(new URL(".", import.meta.url));

export default function (msa: ExtensionAPI) {
  msa.on("resources_discover", () => ({
    promptPaths: [`${baseDir}dynamic.md`],
    skillPaths: [`${baseDir}SKILL.md`],
    themePaths: [`${baseDir}dynamic.json`],
  }));
}
