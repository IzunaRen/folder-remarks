"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemarksViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const webviewHtml_1 = require("./webviewHtml");
class RemarksViewProvider {
    static viewType = "folderRemarksView";
    #context;
    #repo;
    #view;
    constructor(args) {
        this.#context = args.context;
        this.#repo = args.repo;
        this.#repo.onDidChange(() => void this.refresh());
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("folderRemarks.displayPathStyle") ||
                e.affectsConfiguration("folderRemarks.language")) {
                void this.refresh();
            }
        });
    }
    resolveWebviewView(view) {
        this.#view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.#context.extensionUri]
        };
        const initialState = this.buildViewState();
        view.webview.html = (0, webviewHtml_1.renderRemarksWebviewHtml)({ webview: view.webview, initialState });
        view.webview.onDidReceiveMessage(async (msg) => {
            if (!msg || typeof msg !== "object")
                return;
            const type = msg.type;
            if (!type)
                return;
            if (type === "ready") {
                await this.refresh(true);
                return;
            }
            if (type === "add") {
                await vscode.commands.executeCommand("folderRemarks.setRemark");
                return;
            }
            if (type === "open") {
                const folderUri = msg.folderUri;
                if (typeof folderUri !== "string")
                    return;
                await vscode.commands.executeCommand("folderRemarks.openResource", resourceKeyToUri(folderUri));
                return;
            }
            if (type === "edit") {
                const folderUri = msg.folderUri;
                if (typeof folderUri !== "string")
                    return;
                await vscode.commands.executeCommand("folderRemarks.setRemark", resourceKeyToUri(folderUri));
                return;
            }
            if (type === "delete") {
                const folderUri = msg.folderUri;
                if (typeof folderUri !== "string")
                    return;
                await vscode.commands.executeCommand("folderRemarks.deleteRemark", folderUri);
                return;
            }
        });
        void this.refresh(true);
    }
    async refresh(force = false) {
        if (!this.#view)
            return;
        if (!force && !this.#view.visible)
            return;
        const state = this.buildViewState();
        await this.#view.webview.postMessage({ type: "state", ...state });
    }
    buildViewState() {
        const displayPathStyle = vscode.workspace
            .getConfiguration()
            .get("folderRemarks.displayPathStyle", "relative");
        const withDisplayPath = this.#repo.list().map((r) => ({
            folderUri: r.folderUri,
            remarkName: formatRemarkDisplay(r.remarkName),
            displayPath: displayPathStyle === "absolute" ? resourceKeyToFsPath(r.folderUri) : resourceKeyToRelativePath(r.folderUri)
        }));
        const lang = resolveUiLanguage();
        return { remarks: withDisplayPath, displayPathStyle, lang, ui: getUiStrings(lang) };
    }
}
exports.RemarksViewProvider = RemarksViewProvider;
function formatRemarkDisplay(remarkName) {
    const s = (remarkName ?? "").trim();
    const m = s.match(/^【(.+)】$/u);
    const core = (m?.[1] ?? s).trim() || "无";
    return `【${core}】`;
}
function resourceKeyToRelativePath(resourceKey) {
    return resourceKey || ".";
}
function resourceKeyToFsPath(resourceKey) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root)
        return resourceKey;
    const normalized = (resourceKey || ".").replace(/\\/gu, "/").replace(/^[.][/]/u, "");
    if (normalized === "." || normalized === "")
        return root.fsPath;
    const segments = normalized.split("/").filter(Boolean);
    return vscode.Uri.joinPath(root, ...segments).fsPath;
}
function resourceKeyToUri(resourceKey) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root)
        return undefined;
    const normalized = (resourceKey || ".").replace(/\\/gu, "/").replace(/^[.][/]/u, "");
    if (normalized === "." || normalized === "")
        return root;
    const segments = normalized.split("/").filter(Boolean);
    return vscode.Uri.joinPath(root, ...segments);
}
function resolveUiLanguage() {
    const cfg = vscode.workspace.getConfiguration();
    const raw = cfg.get("folderRemarks.language", "auto");
    if (raw === "en" || raw === "zh-cn")
        return raw;
    const envLang = vscode.env.language.toLowerCase();
    return envLang.startsWith("zh") ? "zh-cn" : "en";
}
function getUiStrings(lang) {
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
//# sourceMappingURL=remarksViewProvider.js.map