export type FolderUriString = string;

export type FolderRemark = {
  folderUri: FolderUriString;
  remarkName: string;
  updatedAt: number;
  createdAt: number;
};

export type RemarksStateV1 = {
  version: 1;
  remarksByFolderUri: Record<FolderUriString, FolderRemark>;
};

