const PASTE_START = "\x1b[200~";

const PASTE_END = "\x1b[201~";

function clampPadding(padding: number): number {
  return Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 0;
}

function clampMaxVisible(maxVisible: number): number {
  return Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
}

const editorLimits = {
  PASTE_END,
  PASTE_START,
  clampMaxVisible,
  clampPadding,
};

export default editorLimits;
