import type { ExtensionAPI } from "@msa/coding-agent";

import { registerEffectCommands } from "./overlay-qa/commands-effects.ts";
import { registerLayoutCommands } from "./overlay-qa/commands-layout.ts";
import { registerOverflowCommand } from "./overlay-qa/commands-overflow.ts";

export default function (msa: ExtensionAPI) {
  registerLayoutCommands(msa);
  registerEffectCommands(msa);
  registerOverflowCommand(msa);
}
