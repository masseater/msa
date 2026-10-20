import type autocompleteTypes from "./autocomplete.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

declare namespace editorComponentTypes {
  interface EditorComponent extends tuiComponentTypes.Component {
    getText(): string;

    setText(text: string): void;

    handleInput(data: string): void;

    onSubmit?: (text: string) => void;

    onChange?: (text: string) => void;

    addToHistory?(text: string): void;

    insertTextAtCursor?(text: string): void;

    getExpandedText?(): string;

    setAutocompleteProvider?(provider: autocompleteTypes.AutocompleteProvider): void;

    borderColor?: (str: string) => string;

    setPaddingX?(padding: number): void;

    setAutocompleteMaxVisible?(maxVisible: number): void;
  }
}

export type { editorComponentTypes as default };
