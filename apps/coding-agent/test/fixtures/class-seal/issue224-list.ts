import tui from "@msa/tui";

import Local from "./local.ts";

const list = [tui];
(list[0]! as { Container: unknown }).Container = Local;

export default class X extends tui.Container {}
