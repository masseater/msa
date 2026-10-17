import type { JsonValue } from "../json.ts";
import type { Op, Path, Seg } from "./ops.ts";

export const jsonCost = (value: JsonValue): number => {
  if (value === null) return 4;
  if (typeof value === "string") return value.length + 2;
  if (typeof value === "number") return String(value).length;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (Array.isArray(value)) {
    let cost = 2;
    for (let index = 0; index < value.length; index++)
      cost += jsonCost(value[index]!) + (index === 0 ? 0 : 1);
    return cost;
  }
  let cost = 2;
  let index = 0;
  for (const key of Object.keys(value)) {
    cost += key.length + 3 + jsonCost(value[key]!) + (index++ === 0 ? 0 : 1);
  }
  return cost;
};

const pathCost = (path: Path): number => {
  let cost = 2;
  for (let index = 0; index < path.length; index++) {
    const segment: Seg = path[index]!;
    cost +=
      (typeof segment === "string" ? segment.length + 2 : String(segment).length) +
      (index === 0 ? 0 : 1);
  }
  return cost;
};

export const operationCost = (operation: Op): number => {
  switch (operation[0]) {
    case "r":
      return 6 + jsonCost(operation[1]);
    case "s":
      return 7 + pathCost(operation[1]) + jsonCost(operation[2]);
    case "d":
      return 6 + pathCost(operation[1]);
    case "a":
      return 7 + pathCost(operation[1]) + operation[2].length + 2;
    case "t":
      return 7 + pathCost(operation[1]) + String(operation[2]).length;
    case "p":
      return (
        10 +
        pathCost(operation[1]) +
        String(operation[2]).length +
        String(operation[3]).length +
        jsonCost(operation[4])
      );
    case "m":
      return 7 + pathCost(operation[1]) + jsonCost(operation[2]);
  }
};
