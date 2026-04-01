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
      if (
        e.affectsConfiguration("traeFolderRemarks.displayPathStyle") ||
        e.affectsConfiguration("traeFolderRemarks.language")
      ) {
        void this.refresh();
      }
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
        await vscode.commands.executeCommand("traeFolderRemarks.setRemark");
        return;
      }

      if (type === "open") {
        const folderUri = (msg as { folderUri?: string }).folderUri;
        if (typeof folderUri !== "string") return;
        await vscode.commands.executeCommand("traeFolderRemarks.openResource", resourceKeyToUri(folderUri));
        return;
      }

      if (type === "edit") {
        const folderUri = (msg as { folderUri?: string }).folderUri;
        if (typeof folderUri !== "string") return;
        await vscode.commands.executeCommand("traeFolderRemarks.setRemark", resourceKeyToUri(folderUri));
        return;
      }

      if (type === "delete") {
        const folderUri = (msg as { folderUri?: string }).folderUri;
        if (typeof folderUri !== "string") return;
        await vscode.commands.executeCommand("traeFolderRemarks.deleteRemark", folderUri);
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
    const lang = resolveUiLanguage();
    return { remarks: withDisplayPath, displayPathStyle, lang, ui: getUiStrings(lang) };
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

function resourceKeyToUri(resourceKey: string): vscode.Uri | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return undefined;
  const normalized = (resourceKey || ".").replace(/\\/gu, "/").replace(/^[.][/]/u, "");
  if (normalized === "." || normalized === "") return root;
  const segments = normalized.split("/").filter(Boolean);
  return vscode.Uri.joinPath(root, ...segments);
}

type UiLang = "en" | "zh-cn";

function resolveUiLanguage(): UiLang {
  const cfg = vscode.workspace.getConfiguration();
  const raw = cfg.get<string>("traeFolderRemarks.language", "auto");
  if (raw === "en" || raw === "zh-cn") return raw;
  const envLang = vscode.env.language.toLowerCase();
  return envLang.startsWith("zh") ? "zh-cn" : "en";
}

function getUiStrings(lang: UiLang): {
  title: string;
  searchPlaceholder: string;
  setButton: string;
  emptyLine1: string;
  emptyLine2: string;
  actionOpen: string;
  actionSet: string;
  actionDelete: string;
} {
  if (lang === "zh-cn") {
    return {
      title: "工作区备注",
      searchPlaceholder: "搜索备注…",
      setButton: "设置",
      emptyLine1: "暂无备注。",
      emptyLine2: "点击“设置”或在资源管理器中右键文件/文件夹进行设置。",
      actionOpen: "打开",
      actionSet: "设置",
      actionDelete: "删除"
    };
  }
  return {
    title: "Workspace Remarks",
    searchPlaceholder: "Search remarks...",
    setButton: "Set",
    emptyLine1: "No remarks yet.",
    emptyLine2: "Use the Set button or right-click a file/folder in the Explorer.",
    actionOpen: "Open",
    actionSet: "Set",
    actionDelete: "Delete"
  };
}
