/** Split a leading UTF-8 byte order mark from decoded text. */
export function splitBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

/** Remove a leading UTF-8 byte order mark from decoded text. */
export function stripBom(content: string): string {
  return splitBom(content).text;
}

/** An id as a list row or a message tag shows it: short ids whole, long ones cut to eight characters. */
export function shortId(id: string): string {
  return id.length <= 16 ? id : id.slice(0, 8);
}
