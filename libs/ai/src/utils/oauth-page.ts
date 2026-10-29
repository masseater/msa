import htmlDocumentModule from "./html-document.ts";
import type htmlDocumentTypes from "./html-document.types.ts";

const { escapeHtml, htmlDocument, htmlReply } = htmlDocumentModule;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" aria-hidden="true"><path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z"/><path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"/><path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z"/></svg>`;

const PAGE_STYLE = `    :root {
      --text: #fafafa;
      --text-dim: #a1a1aa;
      --page-bg: #09090b;
      --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--font-sans);
      text-align: center;
    }
    main {
      width: 100%;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .logo {
      width: 72px;
      height: 72px;
      display: block;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 650;
      color: var(--text);
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: var(--text-dim);
      font-size: 15px;
    }
    .details {
      margin-top: 16px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }`;

function renderPage(options: {
  title: string;
  heading: string;
  message: string;
  details?: string | undefined;
}): htmlDocumentTypes.HtmlDocument {
  const details =
    options.details !== undefined && options.details !== ""
      ? `<div class="details">${escapeHtml(options.details)}</div>`
      : "";

  return htmlDocument({
    body: `<main>
  <div class="logo">${LOGO_SVG}</div>
  <h1>${escapeHtml(options.heading)}</h1>
  <p>${escapeHtml(options.message)}</p>
  ${details}
</main>`,
    style: PAGE_STYLE,
    title: options.title,
  });
}

const oauthSuccessReply = (status: number, message: string): htmlDocumentTypes.HtmlReply =>
  htmlReply(
    status,
    renderPage({
      heading: "Authentication successful",
      message,
      title: "Authentication successful",
    }),
  );

const oauthErrorReply = (
  status: number,
  message: string,
  details?: string,
): htmlDocumentTypes.HtmlReply =>
  htmlReply(
    status,
    renderPage({
      details,
      heading: "Authentication failed",
      message,
      title: "Authentication failed",
    }),
  );

const oauthPage = {
  oauthErrorReply,
  oauthSuccessReply,
};

export default oauthPage;
