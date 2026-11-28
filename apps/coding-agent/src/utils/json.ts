function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/gu, (m) => (m[0] === '"' ? m : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/gu, (m, tail) => tail ?? (m[0] === '"' ? m : ""));
}

const json = {
  stripJsonComments,
};

export default json;
