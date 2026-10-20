import type { JsonValue } from "@msa/chord";
import { Function } from "effect";

type JsonContainer = Record<string, JsonValue> | JsonValue[];

const isRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assignRecord = (current: Record<string, JsonValue>, value: Record<string, JsonValue>) => {
  for (const name of Object.keys(current)) if (!Object.hasOwn(value, name)) delete current[name];
  for (const [name, child] of Object.entries(value)) assign(current, name, child);
};

const assignArray = (items: JsonValue[], value: readonly JsonValue[]) => {
  for (let index = 0; index < value.length; index++) {
    if (index < items.length) assign(items, index, value[index]!);
    else items.push(value[index]!);
  }
};

function assign(target: JsonContainer, key: string | number, value: JsonValue): void {
  const slots = target as Record<string | number, JsonValue>;
  const current = slots[key];
  if (isRecord(current) && isRecord(value)) {
    assignRecord(current, value);
    return;
  }
  if (Array.isArray(current) && Array.isArray(value) && current.length <= value.length) {
    assignArray(current as JsonValue[], value);
    return;
  }
  if (current !== value) slots[key] = value;
}

const assignJson: {
  (key: string | number, value: JsonValue): (target: JsonContainer) => void;
  (target: JsonContainer, key: string | number, value: JsonValue): void;
} = Function.dual(3, assign);

const json = {
  assignJson,
};

export default json;
