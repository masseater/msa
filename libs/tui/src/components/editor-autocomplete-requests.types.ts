import type autocompleteTypes from "../autocomplete.types.ts";
import type AutocompleteRequestsClass from "./editor-autocomplete-requests.ts";
import type editorDocumentTypes from "./editor-document.types.ts";

declare namespace editorAutocompleteRequestsTypes {
  interface AutocompleteRequestOptions {
    force: boolean;
    explicitTab: boolean;
  }

  interface AutocompleteRequestHost {
    readonly doc: editorDocumentTypes.EditorDocument;
    provider(): autocompleteTypes.AutocompleteProvider | undefined;
    deliver(
      provider: autocompleteTypes.AutocompleteProvider,
      suggestions: autocompleteTypes.AutocompleteSuggestions | null,
      options: AutocompleteRequestOptions,
    ): void;
  }

  type AutocompleteRequests = AutocompleteRequestsClass;
}

export type { editorAutocompleteRequestsTypes as default };
