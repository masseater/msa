import { readFileSync } from "node:fs";

const readOptionalText = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const optionalFile = { readOptionalText };

export default optionalFile;
