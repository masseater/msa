export function toCodemodeIdentifier(name: string): string {
  let identifier = "";
  for (const char of name) {
    const valid = identifier === "" ? /^[A-Za-z_$]$/u.test(char) : /^[A-Za-z0-9_$]$/u.test(char);
    identifier += valid ? char : "_";
  }
  return identifier === "" ? "_" : identifier;
}
