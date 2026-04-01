"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkspaceKey = createWorkspaceKey;
const crypto_1 = __importDefault(require("crypto"));
function createWorkspaceKey(workspaceFolderUriStrings) {
    const normalized = [...workspaceFolderUriStrings].sort();
    const joined = normalized.join("|");
    return crypto_1.default.createHash("sha256").update(joined).digest("hex").slice(0, 16);
}
//# sourceMappingURL=workspaceKey.js.map