import args from "../cli/args.ts";
import mainModule from "../main.ts";

const cliKit: {
  readonly main: typeof mainModule.main;
  readonly parseArgs: typeof args.parseArgs;
} = {
  main: mainModule.main,
  parseArgs: args.parseArgs,
};

export default cliKit;
