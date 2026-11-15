/** Read entries before the browser clears the drag store. Bound traversal and preserve relative paths. */
export async function readDriveDrop(data: DataTransfer): Promise<{ files: File[]; folders: string[] }> {
  const entries = Array.from(data.items).map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry);
  if (!entries.length) return { files: Array.from(data.files), folders: [] };
  const files: File[] = [];
  const folders: string[] = [];
  let count = 0;
  async function visit(entry: FileSystemEntry, parent: string, depth: number): Promise<void> {
    if (++count > 2000 || depth > 16) throw new Error('This folder is too large to select at once (2,000 entries or 16 levels). Select smaller folders.');
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      Object.defineProperty(file, 'webkitRelativePath', { value: path });
      files.push(file);
    } else if (entry.isDirectory) {
      folders.push(path);
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!children.length) break;
        for (const child of children) await visit(child, path, depth + 1);
      }
    }
  }
  for (const entry of entries) await visit(entry, '', 0);
  return { files, folders };
}
