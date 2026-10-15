import type { RcFile } from "syncpack";

import { requiredStack } from "./lint.config.ts";

const config: RcFile = {
  versionGroups: Object.entries(requiredStack).map(([label, dependencies]) => ({
    label,
    dependencies: [...dependencies],
    isBanned: true,
  })),
};

export default config;
