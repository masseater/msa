import { dual } from "effect/Function";

import cliPart6 from "./cli-part6.ts";
import type cliTypes from "./cli.types.ts";

const { runMcpCommandImpl } = cliPart6;

const runMcpCommand: {
  (args: string[], options: cliTypes.McpCommandOptions): Promise<number>;
  (options: cliTypes.McpCommandOptions): (args: string[]) => Promise<number>;
} = dual((args: IArguments) => args.length >= 2, runMcpCommandImpl);

const cliPart7 = {
  runMcpCommand,
};

export default cliPart7;
