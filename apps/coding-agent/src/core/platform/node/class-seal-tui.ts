import tui from "@msa/tui";

import classSeal from "./class-seal.ts";

const sharedTui: readonly unknown[] = Object.freeze([
  tui.Box,
  tui.Container,
  tui.Editor,
  tui.KeybindingsManager,
  tui.Loader,
  tui.Text,
]);

classSeal.share(sharedTui);

export default sharedTui;
