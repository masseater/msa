import type { RcFile } from "syncpack";

import lintConfig from "./lint.config.ts";

const { requiredStack } = lintConfig;

const config: RcFile = {
  versionGroups: Object.entries(requiredStack).map(([label, dependencies]) => ({
    dependencies: [...dependencies],
    isBanned: true,
    label,
  })),
};

export default config;
