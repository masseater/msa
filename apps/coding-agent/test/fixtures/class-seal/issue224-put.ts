import tui from "@msa/tui";

import Local from "./local.ts";

const put = (target: typeof tui): void => {
  (target as { Container: unknown }).Container = Local;
};
put(tui);

export default class X extends tui.Container {}
