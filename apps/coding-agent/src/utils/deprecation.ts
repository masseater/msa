import chalk from "chalk";

import platform from "../core/platform.ts";

const { writeWarn } = platform;

const emittedDeprecationWarnings = new Set<string>();

function warnDeprecation(message: string): void {
  if (emittedDeprecationWarnings.has(message)) return;
  emittedDeprecationWarnings.add(message);
  writeWarn(chalk.yellow(`Deprecation warning: ${message}`));
}

function clearDeprecationWarningsForTests(): void {
  emittedDeprecationWarnings.clear();
}

const deprecation = {
  clearDeprecationWarningsForTests,
  warnDeprecation,
};

export default deprecation;
