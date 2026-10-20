import argsPart1 from "./args-part1.ts";
import argsPart2 from "./args-part2.ts";
import argsPart3 from "./args-part3.ts";

const { normalizeSessionName } = argsPart1;
const { parseArgs } = argsPart2;
const { printHelp } = argsPart3;

const args = {
  normalizeSessionName,
  parseArgs,
  printHelp,
};

export default args;
