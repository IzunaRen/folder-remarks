import * as vscode from "vscode";
import { RemarksRepository } from "../core/remarksRepository";
import { renderRemarksWebviewHtml } from "./webviewHtml";

export class RemarksViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "traeFolderRemarksView";

  readonly #context: vscode.ExtensionContext;
  readonly #repo: RemarksRepository;
  #view: vscode.WebviewView | undefined;

  constructor(args: { context: vscode.ExtensionContext; repo: RemarksRepository }) {
    this.#context = args.context;
    this.#repo = args.repo;
    this.#repo.onDidChange(() => void this.refresh());
    vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
      if (e.affectsConfiguration("traeFolderRemarks.displayPathStyle")) void this.refresh();
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void | Promise<void> {
    this.#view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.#context.extensionUri]
    };

    const initialState = this.buildViewState();
    view.webview.html = renderRemarksWebviewHtml({ webview: view.webview, initialState });

    view.webview.onDidReceiveMessage(async (msg: unknown) => {
      if (!msg || typeof msg !== "object") return;
      const type = (msg as { type?: string }).type;
      if (!type) return;

      if (type === "ready") {
        await this.refresh(true);
        return;
      }

      if (type === "add") {
        await vscode.commands.executeCommand("traeFolderRemarks.addRemark");
        return;
      }

      if (type === "open") {
        const folderUri = (msg as { folderUri?: string }).folderUri;
        if (typeof folderUri !== "string") return;
        await vscode.commands.executeCommand("traeFolderRemarks.openResource", vscode.Uri.parse(folderUri));
        return;
      }

      if (type === "edit") {
        const folderUri = (msg as { folderUri?: string }).folderUri;
        if (typeof folderUri !== "string") return;
        await vscode.commands.executeCommand("traeFolderRemarks.editRemark", vscode.Uri.parse(folderUri));
        return;
      }

      if (type === "delete") {
        const folderUri = (msg as { folderUri?: string }).folderUri;
        if (typeof folderUri !== "string") return;
        await vscode.commands.executeCommand("traeFolderRemarks.deleteRemark", vscode.Uri.parse(folderUri));
        return;
      }
    });

    void this.refresh(true);
  }

  async refresh(force = false): Promise<void> {
    if (!this.#view) return;
    if (!force && !this.#view.visible) return;
    const state = this.buildViewState();
    await this.#view.webview.postMessage({ type: "state", ...state });
  }

  private buildViewState(): {
    remarks: ReadonlyArray<{ folderUri: string; remarkName: string; displayPath: string }>;
    displayPathStyle: "relative" | "absolute";
  } {
    const displayPathStyle = vscode.workspace
      .getConfiguration()
      .get<"relative" | "absolute">("traeFolderRemarks.displayPathStyle", "relative");
    const withDisplayPath = this.#repo.list().map((r) => ({
      folderUri: r.folderUri,
      remarkName: formatRemarkDisplay(r.remarkName),
      displayPath:
        displayPathStyle === "absolute" ? resourceKeyToFsPath(r.folderUri) : resourceKeyToRelativePath(r.folderUri)
    }));
    return { remarks: withDisplayPath, displayPathStyle };
  }
}

function formatRemarkDisplay(remarkName: string | undefined): string {
  const s = (remarkName ?? "").trim();
  const m = s.match(/^【(.+)】$/u);
  const core = (m?.[1] ?? s).trim() || "无";
  return `【${core}】`;
}

function resourceKeyToRelativePath(resourceKey: string): string {
  return resourceKey || ".";
}

function resourceKeyToFsPath(resourceKey: string): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return resourceKey;
  const normalized = (resourceKey || ".").replace(/\\/gu, "/").replace(/^[.][/]/u, "");
  if (normalized === "." || normalized === "") return root.fsPath;
  const segments = normalized.split("/").filter(Boolean);
  return vscode.Uri.joinPath(root, ...segments).fsPath;
}
