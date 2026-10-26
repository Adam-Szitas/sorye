/** All apps persist original uploads in the workspace Drive before processing. */
export async function uploadToDrive(file: File, sourceAppId: string, endpoint = '/api/files') {
  const body = new FormData();
  body.append('file', file);
  body.append('sourceAppId', sourceAppId);
  const response = await fetch(endpoint, { method: 'POST', credentials: 'include', body });
  const data = await response.json();
  if (!response.ok || !data.file) throw new Error(data.error || 'Could not save file to Drive');
  return data.file as { id: string; displayName: string; mime: string; sourceAppId: string };
}
