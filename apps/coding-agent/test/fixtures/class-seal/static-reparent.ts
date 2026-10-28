import tui from "@msa/tui";

import Local from "./local.ts";

export default class X extends tui.Container {
  static {
    Object.setPrototypeOf(X, Local);
  }
}
