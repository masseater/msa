function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let hasToken = false;
  let inQuote: string | null = null;

  for (const char of argsString) {
    if (inQuote !== null && inQuote !== "") {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
      hasToken = true;
    } else if (/\s/u.test(char)) {
      if (hasToken) {
        args.push(current);
        current = "";
        hasToken = false;
      }
    } else {
      current += char;
      hasToken = true;
    }
  }

  if (hasToken) {
    args.push(current);
  }

  return args;
}

function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");

  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/gu,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultTarget !== undefined) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[parseInt(defaultTarget, 10) - 1];
        return value !== undefined && value !== "" ? value : defaultValue;
      }

      if (sliceStart !== undefined) {
        let start = parseInt(sliceStart, 10) - 1;
        if (start < 0) start = 0;

        if (sliceLength !== undefined) {
          const length = parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }

      if (simple === "ARGUMENTS" || simple === "@") {
        return allArgs;
      }

      const index = parseInt(simple, 10) - 1;
      return args[index] ?? "";
    },
  );
}

const promptTemplateArgs = { parseCommandArgs, substituteArgs };

export default promptTemplateArgs;
