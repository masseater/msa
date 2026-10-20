function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/gu, " ")
    .replace(/ +/gu, " ")
    .trim();
}

const footerHelpers = { sanitizeStatusText };

export default footerHelpers;
