import { dual } from "effect/Function";

import ansiSequences from "../ansi-sequences.ts";
import type editorDocumentTypes from "./editor-document.types.ts";
import editorSegments from "./editor-segments.ts";

const { replaceEscapeSequences } = ansiSequences;
const { normalizeEditorText } = editorSegments;

const CTRL_CSI_U_BODY = /^(\d+);5$/u;
const MAX_INLINE_PASTE_LINES = 10;
const MAX_INLINE_PASTE_CHARS = 1000;

function decodePastedText(pastedText: string): string {
  const decodedText = replaceEscapeSequences(pastedText, (sequence) => {
    const control =
      sequence.kind === "csi" && sequence.final === "u"
        ? CTRL_CSI_U_BODY.exec(sequence.body)
        : null;
    const codepoint = control === null ? Number.NaN : Number(control[1]);
    if (codepoint >= 97 && codepoint <= 122) return String.fromCharCode(codepoint - 96);
    if (codepoint >= 65 && codepoint <= 90) return String.fromCharCode(codepoint - 64);
    return sequence.raw;
  });
  return normalizeEditorText(decodedText)
    .split("")
    .filter((char) => char === "\n" || char.charCodeAt(0) >= 32)
    .join("");
}

function separateFromWord(doc: editorDocumentTypes.EditorDocument, text: string): string {
  if (!/^[/~.]/u.test(text)) return text;
  const charBeforeCursor =
    doc.state.cursorCol > 0 ? doc.currentLine()[doc.state.cursorCol - 1] : "";
  return charBeforeCursor !== undefined && charBeforeCursor !== "" && /\w/u.test(charBeforeCursor)
    ? ` ${text}`
    : text;
}

const insertPaste: {
  (doc: editorDocumentTypes.EditorDocument, pastedText: string): void;
  (pastedText: string): (doc: editorDocumentTypes.EditorDocument) => void;
} = dual(2, (doc: editorDocumentTypes.EditorDocument, pastedText: string): void => {
  const filteredText = separateFromWord(doc, decodePastedText(pastedText));
  const lineCount = filteredText.split("\n").length;
  const totalChars = filteredText.length;
  if (lineCount > MAX_INLINE_PASTE_LINES || totalChars > MAX_INLINE_PASTE_CHARS) {
    const pasteId = doc.addPaste(filteredText);
    doc.insertText(
      lineCount > MAX_INLINE_PASTE_LINES
        ? `[paste #${pasteId} +${lineCount} lines]`
        : `[paste #${pasteId} ${totalChars} chars]`,
    );
    return;
  }
  doc.insertText(filteredText);
});

const editorPaste = {
  decodePastedText,
  insertPaste,
};

export default editorPaste;
