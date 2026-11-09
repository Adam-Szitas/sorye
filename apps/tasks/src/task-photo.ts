import {
  isTaskDriveFileId,
  isTaskPhotoMime,
  TASK_PHOTO_MAX_BYTES,
} from '@sorye/types';
import { hubApiPath } from './hub-origin';

export function taskPhotoUrl(fileId: string | undefined): string | null {
  if (!isTaskDriveFileId(fileId)) return null;
  return hubApiPath(`/api/files/${fileId}?inline=1`);
}

export function taskPhotoRejection(file: File): string | null {
  if (file.type && !isTaskPhotoMime(file.type)) return 'Choose a JPEG, PNG, WebP, or GIF photo.';
  if (file.size <= 0 || file.size > TASK_PHOTO_MAX_BYTES) {
    return `Photos must be under ${Math.floor(TASK_PHOTO_MAX_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

export async function uploadTaskPhoto(file: File): Promise<string> {
  const rejection = taskPhotoRejection(file);
  if (rejection) throw new Error(rejection);
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('sourceAppId', 'tasks');
  const response = await fetch(hubApiPath('/api/files'), {
    method: 'POST',
    credentials: 'include',
    body,
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    file?: { id?: unknown };
  };
  if (!response.ok || !isTaskDriveFileId(data.file?.id)) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Could not store the photo in Drive.');
  }
  return data.file.id;
}

export async function deleteTaskPhoto(fileId: string): Promise<void> {
  if (!isTaskDriveFileId(fileId)) return;
  await fetch(hubApiPath(`/api/files/${fileId}`), {
    method: 'DELETE',
    credentials: 'include',
  }).catch(() => undefined);
}
