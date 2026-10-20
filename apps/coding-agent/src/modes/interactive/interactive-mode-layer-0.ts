import type tuiTypes from "@msa/tui/index.types";

import type agentSessionRuntimeTypes from "../../core/agent-session-runtime.types.ts";
import type agentSessionTypes from "../../core/agent-session.types.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import type customEditorTypes from "./components/custom-editor.types.ts";
import tasksViewHelpers from "./components/tasks-view-helpers.ts";
import type editorSlotTypes from "./editor-slot.types.ts";
import emptyEnterBurstModule from "./empty-enter-burst.ts";
import type emptyEnterBurstTypes from "./empty-enter-burst.types.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";

const { EMPTY_ENTER_BURST_IDLE } = emptyEnterBurstModule;
const { viewHelpers } = tasksViewHelpers;

export default abstract class InteractiveModeLayer0 {
  constructor(runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime) {
    this.runtimeHost = runtimeHost;
  }

  protected get session(): agentSessionTypes.AgentSession {
    return this.runtimeHost.session;
  }

  protected get sessionManager() {
    return this.session.sessionManager;
  }

  protected get settingsManager() {
    return this.session.settingsManager;
  }

  protected runtimeHost!: agentSessionRuntimeTypes.AgentSessionRuntime;
  protected renderer!: tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen;
  protected ui!: tuiTypes.TUI;
  protected mainScreenRenderState!: tuiTypes.TuiMainScreenRenderState | undefined;
  protected loadedResourcesContainer!: tuiTypes.Container;
  protected chatContainer!: tuiTypes.Container;
  protected documentContainer!: tuiTypes.Container;
  protected transcriptScrollView!: tuiTypes.ScrollView | undefined;
  protected fullscreenLayoutRoot!: tuiTypes.Component | undefined;
  protected pendingMessagesContainer!: tuiTypes.Container;
  protected emptyEnterBurst: emptyEnterBurstTypes.EmptyEnterBurst = EMPTY_ENTER_BURST_IDLE;
  protected statusContainer!: tuiTypes.Container;
  protected defaultEditor!: customEditorTypes.CustomEditor;
  protected editor!: interactiveModeInternalTypes.ActiveEditor;
  protected editorComponentFactory!: extensionsTypes.EditorFactory | undefined;
  protected autocompleteProvider!: tuiTypes.AutocompleteProvider | undefined;
  protected autocompleteProviderWrappers: extensionsTypes.AutocompleteProviderFactory[] = [];
  protected fdPath!: string | undefined;
  protected editorContainer!: tuiTypes.Container;
  protected editorSlot!: editorSlotTypes.EditorSlot;
  protected readonly tasksViewState = viewHelpers.createTasksViewState();
}
