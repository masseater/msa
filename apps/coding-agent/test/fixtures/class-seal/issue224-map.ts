import tui from "@msa/tui";

import Local from "./local.ts";

(new Map([["t", tui]]).get("t")! as { Container: unknown }).Container = Local;

export default class X extends tui.Container {}
