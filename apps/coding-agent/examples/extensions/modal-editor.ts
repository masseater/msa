

import { CustomEditor, type ExtensionAPI } from "@msa/coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@msa/tui";


const NORMAL_KEYS: Record<string, string | null> = {
  h: "\x1b[D", 
  j: "\x1b[B", 
  k: "\x1b[A", 
  l: "\x1b[C", 
  "0": "\x01", 
  $: "\x05", 
  x: "\x1b[3~", 
  i: null, 
  a: null, 
};

class ModalEditor extends CustomEditor {
  private mode: "normal" | "insert" = "insert";

  override handleInput(data: string): void {
    
    if (matchesKey(data, "escape")) {
      if (this.mode === "insert") {
        this.mode = "normal";
      } else {
        super.handleInput(data); 
      }
      return;
    }

    
    if (this.mode === "insert") {
      super.handleInput(data);
      return;
    }

    
    if (data in NORMAL_KEYS) {
      const seq = NORMAL_KEYS[data];
      if (data === "i") {
        this.mode = "insert";
      } else if (data === "a") {
        this.mode = "insert";
        super.handleInput("\x1b[C"); 
      } else if (seq !== null && seq !== undefined) {
        super.handleInput(seq);
      }
      return;
    }

    
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    
    const label = this.mode === "normal" ? " NORMAL " : " INSERT ";
    const last = lines.length - 1;
    if (visibleWidth(lines[last]!) >= label.length) {
      lines[last] = truncateToWidth(lines[last]!, width - label.length, "") + label;
    }
    return lines;
  }
}

export default function (msa: ExtensionAPI) {
  msa.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, kb) => new ModalEditor(tui, theme, kb));
  });
}
