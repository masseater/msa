import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";

const nodeFsPromises = {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
};

export default nodeFsPromises;
