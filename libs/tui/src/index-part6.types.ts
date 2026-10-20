import type settingsListTypes from "./components/settings-list.types.ts";
import type spacerTypes from "./components/spacer.types.ts";
import type textTypes from "./components/text.types.ts";
import type truncatedTextTypes from "./components/truncated-text.types.ts";
import type vStackTypes from "./components/v-stack.types.ts";
import type terminalTypes from "./terminal.types.ts";

declare namespace tuiTypesPart6 {
  type SettingsList = settingsListTypes.SettingsList;
  type Spacer = spacerTypes.Spacer;
  type Text = textTypes.Text;
  type TruncatedText = truncatedTextTypes.TruncatedText;
  type VStack = vStackTypes.VStack;
  type ProcessTerminal = terminalTypes.ProcessTerminal;
}

export type { tuiTypesPart6 as default };
