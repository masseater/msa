import { createInterface } from "node:readline";
import { createInterface as createPromiseInterface } from "node:readline/promises";

const nodeReadline = {
  createInterface,
  createPromiseInterface,
};

export default nodeReadline;
