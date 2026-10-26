import tui from "@msa/tui";

import Local from "./local.ts";

const box = { t: tui };
(box.t as { Container: unknown }).Container = Local;

export default class X extends tui.Container {}
