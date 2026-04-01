import { FolderRemark } from "./types";

export function filterRemarks(remarks: readonly FolderRemark[], query: string): FolderRemark[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...remarks];
  return remarks.filter((r) => r.remarkName.toLowerCase().includes(q) || r.folderUri.toLowerCase().includes(q));
}

