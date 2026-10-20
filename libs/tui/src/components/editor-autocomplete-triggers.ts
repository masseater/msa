import { dual } from "effect/Function";

import AutocompleteTriggers from "./autocomplete-triggers.ts";

const bestAutocompleteMatchIndex: {
  (items: ReadonlyArray<{ value: string }>, prefix: string): number;
  (prefix: string): (items: ReadonlyArray<{ value: string }>) => number;
} = dual(2, (items: ReadonlyArray<{ value: string }>, prefix: string): number => {
  if (prefix === "") return -1;
  const exact = items.findIndex((item) => item.value === prefix);
  if (exact !== -1) return exact;
  return items.findIndex((item) => item.value.startsWith(prefix));
});

const editorAutocompleteTriggers = {
  AutocompleteTriggers,
  bestAutocompleteMatchIndex,
};

export default editorAutocompleteTriggers;
