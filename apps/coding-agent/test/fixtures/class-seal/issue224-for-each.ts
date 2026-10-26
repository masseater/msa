import tui from "@msa/tui";

import Local from "./local.ts";

[tui].forEach((t) => {
  (t as { Container: unknown }).Container = Local;
});

export default class X extends tui.Container {}
