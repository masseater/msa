import type argsTypes from "../cli/args.types.ts";
import type mainTypes from "../main.types.ts";

declare namespace codingAgentCliKitTypes {
  type Args = argsTypes.Args;
  type MainOptions = mainTypes.MainOptions;
}

export type { codingAgentCliKitTypes as default };
