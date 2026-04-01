import { describe, expect, test } from "vitest";
import { filterRemarks } from "./search";

describe("filterRemarks", () => {
  test("returns all when query empty", () => {
    const remarks = [{ folderUri: "file:///a", remarkName: "Alpha", createdAt: 1, updatedAt: 1 }];
    expect(filterRemarks(remarks, "")).toEqual(remarks);
    expect(filterRemarks(remarks, "   ")).toEqual(remarks);
  });

  test("matches remarkName and folderUri, case-insensitive", () => {
    const remarks = [
      { folderUri: "file:///My-Folder", remarkName: "研发", createdAt: 1, updatedAt: 1 },
      { folderUri: "file:///other", remarkName: "Docs", createdAt: 1, updatedAt: 1 }
    ];
    expect(filterRemarks(remarks, "研发").length).toBe(1);
    expect(filterRemarks(remarks, "my-folder").length).toBe(1);
    expect(filterRemarks(remarks, "DOCS").length).toBe(1);
  });
});

