import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import ModeCommands from "../src/modes/interactive/mode/commands.ts";
import ModeDisplay from "../src/modes/interactive/mode/display.ts";
import ModeExtensions from "../src/modes/interactive/mode/extensions.ts";
import InputHandling from "../src/modes/interactive/mode/input.ts";
import InteractiveLayout from "../src/modes/interactive/mode/layout.ts";
import ModeLifecycle from "../src/modes/interactive/mode/lifecycle.ts";
import ModeModels from "../src/modes/interactive/mode/models.ts";
import ModeSelectors from "../src/modes/interactive/mode/selectors.ts";
import ChatView from "../src/modes/interactive/mode/view.ts";

const PARTS = {
  commands: ModeCommands,
  display: ModeDisplay,
  extensions: ModeExtensions,
  input: InputHandling,
  lifecycle: ModeLifecycle,
  models: ModeModels,
  selectors: ModeSelectors,
  view: ChatView,
} as const;

const bound = new WeakSet<object>();

const partsOf = (group: object): object[] =>
  Object.values(group).flatMap((part: object) => ("mode" in part ? [part] : partsOf(part)));

const collaboratorsOf = (mode: Record<string, unknown>): object[] => [
  mode["layout"] as object,
  ...Object.keys(PARTS).flatMap((domain) => partsOf(mode[domain] as object)),
];

const forwardTo = (target: object, key: string, fake: Record<string, unknown>) =>
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => fake[key],
    set: (value: unknown) => {
      fake[key] = value;
    },
  });

function bindModeFake<T extends object>(fake: T): T & InteractiveMode {
  const mode = fake as Record<string, unknown>;
  if (bound.has(fake)) return fake as T & InteractiveMode;
  bound.add(fake);
  if (Object.getPrototypeOf(fake) === Object.prototype) {
    Object.setPrototypeOf(fake, InteractiveMode.prototype);
  }
  if (!("runtimeHost" in mode)) {
    for (const key of ["session", "sessionManager", "settingsManager"] as const) {
      if (Object.hasOwn(mode, key)) continue;
      const session = Object.getOwnPropertyDescriptor(mode, "session")?.value as
        | Record<string, unknown>
        | undefined;
      Object.defineProperty(fake, key, {
        configurable: true,
        value: key === "session" ? undefined : session?.[key],
        writable: true,
      });
    }
  }
  const flatKeys = Object.keys(fake);
  if (!("layout" in mode)) {
    Object.defineProperty(fake, "layout", { value: new InteractiveLayout(fake as never) });
  }
  for (const [domain, Part] of Object.entries(PARTS)) {
    if (!(domain in mode)) Object.defineProperty(fake, domain, { value: new Part(fake as never) });
  }
  for (const key of flatKeys) {
    if (key === "mode") continue;
    for (const collaborator of collaboratorsOf(mode)) {
      if (key in collaborator) forwardTo(collaborator, key, mode);
    }
  }
  return fake as T & InteractiveMode;
}

const interactiveModeFake = { bindModeFake };

export default interactiveModeFake;
