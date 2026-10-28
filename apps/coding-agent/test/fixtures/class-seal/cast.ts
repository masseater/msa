import tui from "@msa/tui";

import Local from "./local.ts";

export default class X extends (Local as unknown as typeof tui.Container) {}
