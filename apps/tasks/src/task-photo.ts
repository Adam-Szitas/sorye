import {
  isTaskDriveFileId,
  isTaskPhotoMime,
  TASK_ATTACHMENT_MAX,
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

/** Accept a batch of images or reject the whole batch. Non-images are not stored. */
export function takeTaskImages(current: number, files: readonly File[]): { accepted: File[]; error: string | null } {
  if (files.length === 0) return { accepted: [], error: null };
  if (files.some((file) => file.type && !isTaskPhotoMime(file.type))) {
    return { accepted: [], error: 'Only JPEG, PNG, WebP, or GIF images can be added.' };
  }
  for (const file of files) {
    const rejection = taskPhotoRejection(file);
    if (rejection) return { accepted: [], error: rejection };
  }
  if (current + files.length > TASK_ATTACHMENT_MAX) {
    return { accepted: [], error: `A ticket can hold ${TASK_ATTACHMENT_MAX} images.` };
  }
  return { accepted: [...files], error: null };
}

export function imageFilesFromTransfer(data: DataTransfer | null): { images: File[]; rejected: boolean } {
  if (!data) return { images: [], rejected: false };
  const images: File[] = [];
  let rejected = false;
  const items = data.items ? [...data.items] : [];
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (!item.type || item.type.startsWith('image/') || !file.type || file.type.startsWith('image/')) images.push(file);
      else rejected = true;
    }
  } else {
    for (const file of data.files) {
      if (!file.type || file.type.startsWith('image/')) images.push(file);
      else rejected = true;
    }
  }
  return { images, rejected };
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
