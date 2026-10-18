const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

export function segmentWords(text: string): string[] {
  const words: string[] = [];
  for (const segment of segmenter.segment(text.toLowerCase())) {
    if (segment.isWordLike === true) words.push(segment.segment);
  }
  return words;
}

export function phrase(word: string): string {
  return `"${word.replaceAll('"', '""')}"`;
}

export function searchQuery(text: string): string {
  const words = [...new Set(segmentWords(text))];
  return words.map(phrase).join(" OR ");
}

export function firstLine(text: string | undefined): string {
  const line = (text ?? "").split("\n").find((candidate) => candidate.trim().length > 0);
  return line?.trim() ?? "";
}
