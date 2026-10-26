export type CloudStorageProvider = 'aws-s3' | 'cloudflare-r2';

/** Safe connection metadata; never includes access keys or secret material. */
export interface CloudStorageConnection {
  id: string;
  name: string;
  provider: CloudStorageProvider;
  bucket: string;
  region: string;
  accountId?: string;
  accessKeyHint: string;
  createdAt: string;
}

export interface CloudStorageObject {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  isFolder: boolean;
}
