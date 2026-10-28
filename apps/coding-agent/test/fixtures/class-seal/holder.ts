import tui from "@msa/tui";

import Local from "./local.ts";

let base: typeof tui.Container = tui.Container;

const holder = {
  current: () => base,
  swap: (): void => {
    base = Local as unknown as typeof tui.Container;
  },
};

export default holder;
