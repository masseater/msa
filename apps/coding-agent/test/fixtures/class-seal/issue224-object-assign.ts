import tui from "@msa/tui";

import Local from "./local.ts";

const box = { t: tui };
Object.assign(box.t, { Container: Local });

export default class X extends tui.Container {}
