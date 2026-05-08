export type UploadProgress = {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
};

export type ProjectRecord = {
  id: string;
  name: string;
  fileName: string;
  fileUrl: string;
  storagePath?: string;
  createdAt: string;
  source: "firebase" | "local";
};

export type StorageAdapter = {
  mode: "firebase" | "local";
  createProject(file: File, onProgress: (progress: UploadProgress) => void): Promise<ProjectRecord>;
  getProject(projectId: string): Promise<ProjectRecord | null>;
  listRecentProjects(): Promise<ProjectRecord[]>;
};
