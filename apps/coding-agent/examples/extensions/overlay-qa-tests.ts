import type codingAgentTypes from "@msa/coding-agent/index.types";

import commandsEffects from "./overlay-qa/commands-effects.ts";
import commandsLayout from "./overlay-qa/commands-layout.ts";
import commandsOverflow from "./overlay-qa/commands-overflow.ts";

const { registerLayoutCommands } = commandsLayout;
const { registerEffectCommands } = commandsEffects;
const { registerOverflowCommand } = commandsOverflow;

export default function (msa: codingAgentTypes.ExtensionAPI) {
  registerLayoutCommands(msa);
  registerEffectCommands(msa);
  registerOverflowCommand(msa);
}
