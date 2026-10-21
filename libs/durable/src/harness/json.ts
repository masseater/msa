import type chordTypes from "@msa/chord/index.types";
import { Function } from "effect";

type JsonContainer = Record<string, chordTypes.JsonValue> | chordTypes.JsonValue[];

const isRecord = (
  value: chordTypes.JsonValue | undefined,
): value is Record<string, chordTypes.JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assignRecord = (
  current: Record<string, chordTypes.JsonValue>,
  value: Record<string, chordTypes.JsonValue>,
) => {
  for (const name of Object.keys(current)) if (!Object.hasOwn(value, name)) delete current[name];
  for (const [name, child] of Object.entries(value)) assign(current, name, child);
};

const assignArray = (items: chordTypes.JsonValue[], value: readonly chordTypes.JsonValue[]) => {
  for (let index = 0; index < value.length; index++) {
    if (index < items.length) assign(items, index, value[index]!);
    else items.push(value[index]!);
  }
};

function assign(target: JsonContainer, key: string | number, value: chordTypes.JsonValue): void {
  const slots = target as Record<string | number, chordTypes.JsonValue>;
  const current = slots[key];
  if (isRecord(current) && isRecord(value)) {
    assignRecord(current, value);
    return;
  }
  if (Array.isArray(current) && Array.isArray(value) && current.length <= value.length) {
    assignArray(current as chordTypes.JsonValue[], value);
    return;
  }
  if (current !== value) slots[key] = value;
}

const assignJson: {
  (key: string | number, value: chordTypes.JsonValue): (target: JsonContainer) => void;
  (target: JsonContainer, key: string | number, value: chordTypes.JsonValue): void;
} = Function.dual(3, assign);

const json = {
  assignJson,
};

export default json;
