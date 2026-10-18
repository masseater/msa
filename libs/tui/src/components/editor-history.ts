import type { EditorDocument, EditorState } from "./editor-document.ts";

const MAX_HISTORY_ENTRIES = 100;

export class EditorHistory {
  private readonly entries: string[] = [];
  private index = -1;
  private draft: EditorState | null = null;
  private readonly doc: EditorDocument;

  constructor(doc: EditorDocument) {
    this.doc = doc;
  }

  get isBrowsing(): boolean {
    return this.index > -1;
  }

  add(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "") return;
    if (this.entries.length > 0 && this.entries[0] === trimmed) return;
    this.entries.unshift(trimmed);
    if (this.entries.length > MAX_HISTORY_ENTRIES) {
      this.entries.pop();
    }
  }

  exit(): void {
    this.index = -1;
    this.draft = null;
  }

  navigate(direction: 1 | -1): void {
    this.doc.lastAction = null;
    if (this.entries.length === 0) return;

    const newIndex = this.index - direction;
    if (newIndex < -1 || newIndex >= this.entries.length) return;

    if (this.index === -1 && newIndex >= 0) {
      this.doc.pushUndoSnapshot();
      this.draft = structuredClone(this.doc.state);
    }

    this.index = newIndex;

    if (this.index === -1) {
      const draft = this.draft;
      this.draft = null;
      if (draft === null) {
        this.doc.replaceText("");
      } else {
        this.doc.restoreState(draft);
      }
    } else {
      this.doc.replaceText(this.entries[this.index] || "", direction === -1 ? "start" : "end");
    }
  }
}
