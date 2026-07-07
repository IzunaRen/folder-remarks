import * as vscode from "vscode";
import { createNonce } from "../utils/nonce";

export function renderRemarksWebviewHtml(args: {
  webview: vscode.Webview;
  initialState: {
    remarks: ReadonlyArray<{ folderUri: string; remarkName: string; displayPath: string }>;
    displayPathStyle: "relative" | "absolute";
    lang: "en" | "zh-cn";
    ui: {
      title: string;
      searchPlaceholder: string;
      setButton: string;
      emptyLine1: string;
      emptyLine2: string;
      actionOpen: string;
      actionSet: string;
      actionDelete: string;
    };
  };
}): string {
  const nonce = createNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${args.webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");

  const initialData = JSON.stringify(args.initialState);

  return `<!doctype html>
<html lang="${escapeAttr(args.initialState.lang)}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(args.initialState.ui.title)}</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        padding: 10px 10px 14px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      input[type='search'] {
        width: 100%;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 6px 8px;
        border-radius: 4px;
      }
      button {
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        padding: 6px 10px;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
      }
      button.secondary {
        background: transparent;
        border: 1px solid var(--vscode-input-border);
        color: var(--vscode-foreground);
      }
      .list {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .item {
        border: 1px solid var(--vscode-input-border);
        border-radius: 6px;
        padding: 8px;
      }
      .title {
        display: flex;
        gap: 8px;
        align-items: baseline;
        justify-content: space-between;
      }
      .name {
        font-weight: 600;
        word-break: break-word;
      }
      .path {
        opacity: 0.8;
        font-size: 12px;
        margin-top: 4px;
        word-break: break-all;
      }
      .actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .action {
        background: transparent;
        border: 1px solid var(--vscode-input-border);
        color: var(--vscode-foreground);
        padding: 4px 8px;
      }
      .context-menu {
        position: fixed;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border);
        border-radius: 4px;
        padding: 4px 0;
        z-index: 1000;
        min-width: 120px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      .context-menu-item {
        display: block;
        width: 100%;
        padding: 6px 12px;
        border: none;
        background: transparent;
        color: var(--vscode-menu-foreground);
        text-align: left;
        cursor: pointer;
        font-size: inherit;
        font-family: inherit;
      }
      .context-menu-item:hover {
        background: var(--vscode-menu-selectionBackground);
        color: var(--vscode-menu-selectionForeground);
      }
      .empty {
        opacity: 0.8;
        margin-top: 14px;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <div class="row">
      <input id="q" type="search" placeholder="${escapeAttr(args.initialState.ui.searchPlaceholder)}" />
      <button id="add">${escapeHtml(args.initialState.ui.setButton)}</button>
    </div>

    <div id="list" class="list"></div>
    <div id="empty" class="empty" style="display:none">
      <div>${escapeHtml(args.initialState.ui.emptyLine1)}</div>
      <div>${escapeHtml(args.initialState.ui.emptyLine2)}</div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = ${initialData};
      let query = "";

      const qEl = document.getElementById("q");
      const listEl = document.getElementById("list");
      const emptyEl = document.getElementById("empty");
      const addEl = document.getElementById("add");

      function normalize(s) {
        return String(s ?? "").toLowerCase();
      }

      function displayPath(folderUri) {
        const item = state.remarks.find((r) => r.folderUri === folderUri);
        return item?.displayPath ?? folderUri;
      }

      function render() {
        const q = normalize(query).trim();
        const items = !q
          ? state.remarks
          : state.remarks.filter((r) => normalize(r.remarkName).includes(q) || normalize(r.folderUri).includes(q));

        listEl.innerHTML = "";
        emptyEl.style.display = items.length === 0 && state.remarks.length === 0 ? "block" : "none";

        for (const r of items) {
          const item = document.createElement("div");
          item.className = "item";
          item.dataset.uri = r.folderUri;
          item.innerHTML = \`
            <div class="title">
              <div class="name">\${escapeHtml(r.remarkName || "【无】")}</div>
              <div class="actions">
                <button class="action" data-act="open" data-uri="\${encodeAttr(r.folderUri)}">\${escapeHtml(state.ui.actionOpen)}</button>
              </div>
            </div>
            <div class="path">\${escapeHtml(displayPath(r.folderUri))}</div>
          \`;
          item.addEventListener("click", (e) => {
            const act = e.target?.dataset?.act;
            const uri = e.target?.dataset?.uri;
            if (!act || !uri) return;
            vscode.postMessage({ type: act, folderUri: uri });
          });
          item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            showContextMenu(e, r.folderUri);
          });
          listEl.appendChild(item);
        }
      }

      let contextMenuEl = null;

      function showContextMenu(e, folderUri) {
        closeContextMenu();
        contextMenuEl = document.createElement("div");
        contextMenuEl.className = "context-menu";
        contextMenuEl.style.left = e.clientX + "px";
        contextMenuEl.style.top = e.clientY + "px";
        contextMenuEl.innerHTML = \`
          <button class="context-menu-item" data-act="edit" data-uri="\${encodeAttr(folderUri)}">\${escapeHtml(state.ui.actionSet)}</button>
          <button class="context-menu-item" data-act="delete" data-uri="\${encodeAttr(folderUri)}">\${escapeHtml(state.ui.actionDelete)}</button>
        \`;
        contextMenuEl.addEventListener("click", (ev) => {
          const act = ev.target?.dataset?.act;
          const uri = ev.target?.dataset?.uri;
          if (!act || !uri) return;
          vscode.postMessage({ type: act, folderUri: uri });
          closeContextMenu();
        });
        document.body.appendChild(contextMenuEl);
      }

      function closeContextMenu() {
        if (contextMenuEl) {
          contextMenuEl.remove();
          contextMenuEl = null;
        }
      }

      function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[c]));
      }

      function encodeAttr(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[c]));
      }

      qEl.addEventListener("input", () => {
        query = qEl.value ?? "";
        render();
      });

      addEl.addEventListener("click", () => vscode.postMessage({ type: "add" }));

      window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "state") {
          state.remarks = msg.remarks ?? [];
          state.displayPathStyle = msg.displayPathStyle ?? "relative";
          state.lang = msg.lang ?? state.lang;
          state.ui = msg.ui ?? state.ui;
          render();
        }
      });

      document.addEventListener("click", () => {
        closeContextMenu();
      });

      render();
      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
}

function escapeHtml(str: string): string {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function escapeAttr(str: string): string {
  return escapeHtml(str);
}
