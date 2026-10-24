interface Heredoc {
  delimiter: string;
  stripTabs: boolean;
}

const SEPARATORS = ";&|()";
const DELIMITER_END = /[\s;&|<>()]/u;

class Lexer {
  readonly commands: string[][] = [];
  private words: string[] = [];
  private word = "";
  private inWord = false;
  private readonly heredocs: Heredoc[] = [];
  private index = 0;
  private readonly script: string;

  constructor(script: string) {
    this.script = script;
  }

  run(): string[][] {
    const { script } = this;
    while (this.index < script.length) this.step(script[this.index] ?? "");
    this.endCommand();
    return this.commands;
  }

  private step(char: string): void {
    const { script } = this;
    const next = script[this.index + 1];
    if (char === "\\") {
      if (next !== "\n") this.append(next ?? "");
      this.index += 2;
    } else if (char === "'") {
      const end = script.indexOf("'", this.index + 1);
      const stop = end === -1 ? script.length : end;
      this.append(script.slice(this.index + 1, stop));
      this.index = stop + 1;
    } else if (char === '"') {
      this.index = this.doubleQuoted(this.index + 1);
    } else if (char === "$" && next === "(") {
      this.index = this.substitution(this.index + 2, ")");
      this.inWord = true;
    } else if (char === "`") {
      this.index = this.substitution(this.index + 1, "`");
      this.inWord = true;
    } else if (char === "#" && !this.inWord) {
      const end = script.indexOf("\n", this.index);
      this.index = end === -1 ? script.length : end;
    } else if (char === "\n") {
      this.endCommand();
      this.index = this.skipHeredocs(this.index + 1);
    } else if (SEPARATORS.includes(char)) {
      this.endCommand();
      this.index += 1;
    } else if (char === "<" && next === "<" && script[this.index + 2] !== "<") {
      this.endWord();
      this.index = this.heredocStart(this.index + 2);
    } else if (char === " " || char === "\t") {
      this.endWord();
      this.index += 1;
    } else {
      this.append(char);
      this.index += 1;
    }
  }

  private append(text: string): void {
    this.word += text;
    this.inWord = true;
  }

  private endWord(): void {
    if (this.inWord) this.words.push(this.word);
    this.word = "";
    this.inWord = false;
  }

  private endCommand(): void {
    this.endWord();
    if (this.words.length > 0) this.commands.push(this.words);
    this.words = [];
  }

  private doubleQuoted(start: number): number {
    const { script } = this;
    let index = start;
    this.inWord = true;
    while (index < script.length && script[index] !== '"') {
      const char = script[index] ?? "";
      if (char === "\\") {
        this.word += script[index + 1] ?? "";
        index += 2;
      } else if (char === "$" && script[index + 1] === "(") {
        index = this.substitution(index + 2, ")");
      } else if (char === "`") {
        index = this.substitution(index + 1, "`");
      } else {
        this.word += char;
        index += 1;
      }
    }
    return index + 1;
  }

  private substitution(start: number, closing: ")" | "`"): number {
    const { script } = this;
    let depth = 1;
    let quote: string | null = null;
    let index = start;
    for (; index < script.length; index += 1) {
      const char = script[index];
      if (quote !== null) {
        if (char === quote) quote = null;
        else if (char === "\\" && quote === '"') index += 1;
      } else if (char === "\\") {
        index += 1;
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (closing === "`") {
        if (char === "`") break;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    this.commands.push(...new Lexer(script.slice(start, index)).run());
    return index + 1;
  }

  private heredocStart(start: number): number {
    const { script } = this;
    let index = start;
    const stripTabs = script[index] === "-";
    if (stripTabs) index += 1;
    while (script[index] === " " || script[index] === "\t") index += 1;
    let delimiter = "";
    while (index < script.length && !DELIMITER_END.test(script[index] ?? "")) {
      const char = script[index] ?? "";
      if (char === "'" || char === '"') {
        const end = script.indexOf(char, index + 1);
        const stop = end === -1 ? script.length : end;
        delimiter += script.slice(index + 1, stop);
        index = stop + 1;
      } else {
        if (char !== "\\") delimiter += char;
        index += 1;
      }
    }
    if (delimiter !== "") this.heredocs.push({ delimiter, stripTabs });
    return index;
  }

  private skipHeredocs(start: number): number {
    const { script } = this;
    let index = start;
    for (const heredoc of this.heredocs.splice(0)) {
      while (index < script.length) {
        const end = script.indexOf("\n", index);
        const stop = end === -1 ? script.length : end;
        const line = script.slice(index, stop);
        index = stop + 1;
        if ((heredoc.stripTabs ? line.replace(/^\t+/u, "") : line) === heredoc.delimiter) break;
      }
    }
    return index;
  }
}

function commandsOf(script: string): string[][] {
  return new Lexer(script).run();
}

const shellWords = { commandsOf };

export default shellWords;
