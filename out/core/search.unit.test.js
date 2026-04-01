"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const search_1 = require("./search");
(0, vitest_1.describe)("filterRemarks", () => {
    (0, vitest_1.test)("returns all when query empty", () => {
        const remarks = [{ folderUri: "file:///a", remarkName: "Alpha", createdAt: 1, updatedAt: 1 }];
        (0, vitest_1.expect)((0, search_1.filterRemarks)(remarks, "")).toEqual(remarks);
        (0, vitest_1.expect)((0, search_1.filterRemarks)(remarks, "   ")).toEqual(remarks);
    });
    (0, vitest_1.test)("matches remarkName and folderUri, case-insensitive", () => {
        const remarks = [
            { folderUri: "file:///My-Folder", remarkName: "研发", createdAt: 1, updatedAt: 1 },
            { folderUri: "file:///other", remarkName: "Docs", createdAt: 1, updatedAt: 1 }
        ];
        (0, vitest_1.expect)((0, search_1.filterRemarks)(remarks, "研发").length).toBe(1);
        (0, vitest_1.expect)((0, search_1.filterRemarks)(remarks, "my-folder").length).toBe(1);
        (0, vitest_1.expect)((0, search_1.filterRemarks)(remarks, "DOCS").length).toBe(1);
    });
});
//# sourceMappingURL=search.unit.test.js.map