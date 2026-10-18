import chalk from "chalk";

import { writeWarn } from "../core/platform.ts";

const emittedDeprecationWarnings = new Set<string>();

export function warnDeprecation(message: string): void {
  if (emittedDeprecationWarnings.has(message)) return;
  emittedDeprecationWarnings.add(message);
  writeWarn(chalk.yellow(`Deprecation warning: ${message}`));
}

export function clearDeprecationWarningsForTests(): void {
  emittedDeprecationWarnings.clear();
}
