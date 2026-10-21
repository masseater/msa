const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

function segmentWords(text: string): string[] {
  const words: string[] = [];
  for (const segment of segmenter.segment(text.toLowerCase())) {
    if (segment.isWordLike === true) words.push(segment.segment);
  }
  return words;
}

function phrase(word: string): string {
  return `"${word.replaceAll('"', '""')}"`;
}

function searchQuery(text: string): string {
  const words = [...new Set(segmentWords(text))];
  return words.map(phrase).join(" OR ");
}

function firstLine(text: string | undefined): string {
  const line = (text ?? "").split("\n").find((candidate) => candidate.trim().length > 0);
  return line?.trim() ?? "";
}

function requireStates(
  label: string,
  currentState: string | undefined,
  goalState: string | undefined,
): { currentState: string; goalState: string } {
  if (currentState === undefined || currentState.trim() === "") {
    throw new Error(`${label} needs a current state`);
  }
  if (goalState === undefined || goalState.trim() === "") {
    throw new Error(`${label} needs a goal state`);
  }
  return { currentState, goalState };
}

const text = {
  firstLine,
  phrase,
  requireStates,
  searchQuery,
  segmentWords,
};

export default text;
