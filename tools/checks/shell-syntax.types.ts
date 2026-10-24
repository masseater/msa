declare namespace shellSyntaxTypes {
  interface Word {
    readonly dynamic: boolean;
    readonly text: string;
  }

  interface Assignment {
    readonly name: string;
    readonly value: Word;
  }

  interface Simple {
    readonly assignments: ReadonlyArray<Assignment>;
    readonly kind: "simple";
    readonly substitutions: ReadonlyArray<Script>;
    readonly text: string;
    readonly words: ReadonlyArray<Word>;
  }

  interface Group {
    readonly body: Script;
    readonly isolated: boolean;
    readonly kind: "group";
    readonly text: string;
  }

  interface Unreadable {
    readonly kind: "unreadable";
    readonly syntax: string;
    readonly text: string;
  }

  type Item = Group | Simple | Unreadable;

  type Link = "and" | "concurrent" | "or" | "seq" | "start";

  interface Step {
    readonly item: Item;
    readonly link: Link;
  }

  type Script = ReadonlyArray<Step>;

  type Parse = (source: string) => Script;
}

export type { shellSyntaxTypes as default };
