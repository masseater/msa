import type editorAutocompleteTriggers from "./editor-autocomplete-triggers.ts";

declare namespace editorAutocompleteTriggersTypes {
  type AutocompleteTriggers = (typeof editorAutocompleteTriggers.AutocompleteTriggers)["prototype"];
}

export type { editorAutocompleteTriggersTypes as default };
