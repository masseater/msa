import type InteractiveMode from "../interactive-mode.ts";
import AutocompleteLabels from "./autocomplete-labels.ts";
import AutocompleteSetup from "./autocomplete.ts";
import BashInput from "./bash-input.ts";
import ClipboardImages from "./clipboard-images.ts";
import ClipboardInput from "./clipboard-input.ts";
import EditorComponents from "./editor-components.ts";
import EditorSubmission from "./editor-submission.ts";
import KeyHandlers from "./key-handlers.ts";
import QueuedMessages from "./queued-messages.ts";

export default class InputHandling {
  readonly autocompleteLabels: AutocompleteLabels;
  readonly clipboardImages: ClipboardImages;
  readonly submit: EditorSubmission;
  readonly queue: QueuedMessages;
  readonly keys: KeyHandlers;
  readonly clipboard: ClipboardInput;
  readonly bash: BashInput;
  readonly autocomplete: AutocompleteSetup;
  readonly editors: EditorComponents;

  constructor(mode: InteractiveMode) {
    this.autocompleteLabels = new AutocompleteLabels(mode);
    this.clipboardImages = new ClipboardImages(mode);
    this.submit = new EditorSubmission(mode);
    this.queue = new QueuedMessages(mode);
    this.keys = new KeyHandlers(mode);
    this.clipboard = new ClipboardInput(mode);
    this.bash = new BashInput(mode);
    this.autocomplete = new AutocompleteSetup(mode);
    this.editors = new EditorComponents(mode);
  }
}
