import type { Context } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";

const createReporter = (context: Context, message: string) => {
  const reported = new Set<number>();
  return (node: flowTypes.Node): void => {
    if (reported.has(node.start)) return;
    reported.add(node.start);
    context.report({ message, node });
  };
};

const reporter = { createReporter };

export default reporter;
