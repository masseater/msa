import { readFileSync } from "node:fs";

const readProcessEnvironFile = (): string | undefined => {
  try {
    return readFileSync("/proc/self/environ", "utf-8");
  } catch {
    return undefined;
  }
};

const processEnviron = { readProcessEnvironFile };

export default processEnviron;
