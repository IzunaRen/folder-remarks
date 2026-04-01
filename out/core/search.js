"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterRemarks = filterRemarks;
function filterRemarks(remarks, query) {
    const q = query.trim().toLowerCase();
    if (!q)
        return [...remarks];
    return remarks.filter((r) => r.remarkName.toLowerCase().includes(q) || r.folderUri.toLowerCase().includes(q));
}
//# sourceMappingURL=search.js.map