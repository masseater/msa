import tui from "@msa/tui";

import Local from "./local.ts";

const passthrough = <T>(value: T): T => value;
(passthrough(tui) as { Container: unknown }).Container = Local;

export default class X extends tui.Container {}
