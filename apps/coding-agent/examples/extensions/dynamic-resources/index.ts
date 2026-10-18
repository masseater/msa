import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@msa/coding-agent";

const baseDir = fileURLToPath(new URL(".", import.meta.url));

export default function (msa: ExtensionAPI) {
  msa.on("resources_discover", () => ({
    skillPaths: [`${baseDir}SKILL.md`],
    promptPaths: [`${baseDir}dynamic.md`],
    themePaths: [`${baseDir}dynamic.json`],
  }));
}
