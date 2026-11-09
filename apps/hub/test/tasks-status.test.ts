import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultTasksBoard, isTaskDriveFileId } from '@sorye/types';
import { actionBatchSchema } from '../lib/rodrigo/action-validation';
import { taskSectionPhotoError } from '../lib/files';
import { parseTasksBoard } from '../lib/workspace-docs-validate';
import { StatusHandler } from '../../tasks/src/status-handler';

const PHOTO = '3f1c2c2a-6a4e-4b1a-8c3d-9a0b1c2d3e4f';
const now = '2026-11-09T12:00:00.000Z';

test('moving a task keeps its label, description, and photo and does not fall back to backlog', () => {
  const board = createDefaultTasksBoard();
  const source = board.tasks.find((task) => task.statusId === 'status-backlog');
  assert.ok(source);
  const moved = new StatusHandler(board).moveTaskToStatus(source.id, 'status-done');
  const afterMove = moved.getBoard().tasks.find((task) => task.id === source.id);
  assert.ok(afterMove);
  assert.equal(afterMove.statusId, 'status-done');
  assert.equal(afterMove.title, source.title);
  assert.equal(afterMove.body, source.body);
  assert.equal(afterMove.driveFileId, undefined);

  const edited = moved.updateTask(source.id, { title: 'Renamed', body: 'With notes', driveFileId: PHOTO });
  const afterEdit = edited.getBoard().tasks.find((task) => task.id === source.id);
  assert.ok(afterEdit);
  assert.equal(afterEdit.statusId, 'status-done');
  assert.equal(afterEdit.title, 'Renamed');
  assert.equal(afterEdit.body, 'With notes');
  assert.equal(afterEdit.driveFileId, PHOTO);

  const shifted = edited.moveTaskToStatus(source.id, 'status-review');
  const afterShift = shifted.getBoard().tasks.find((task) => task.id === source.id);
  assert.ok(afterShift);
  assert.equal(afterShift.statusId, 'status-review');
  assert.equal(afterShift.title, 'Renamed');
  assert.equal(afterShift.body, 'With notes');
  assert.equal(afterShift.driveFileId, PHOTO);

  const cleared = shifted.updateTask(source.id, { driveFileId: undefined });
  const afterClear = cleared.getBoard().tasks.find((task) => task.id === source.id);
  assert.ok(afterClear);
  assert.equal(afterClear.statusId, 'status-review');
  assert.equal(Object.hasOwn(afterClear, 'driveFileId'), false);
});

test('task board reads keep a real status and a Drive photo id', () => {
  assert.equal(isTaskDriveFileId(PHOTO), true);
  assert.equal(isTaskDriveFileId('../tasks/secret'), false);
  const parsed = parseTasksBoard({
    statuses: createDefaultTasksBoard().statuses,
    tasks: [{
      id: 'task-1', title: 'Photo', body: 'See image', statusId: 'status-done',
      driveFileId: PHOTO, createdAt: now, updatedAt: now,
    }],
  });
  assert.equal(parsed.tasks[0]?.statusId, 'status-done');
  assert.equal(parsed.tasks[0]?.driveFileId, PHOTO);
  assert.throws(() => parseTasksBoard({
    statuses: createDefaultTasksBoard().statuses,
    tasks: [{
      id: 'task-1', title: 'Photo', body: '', statusId: 'status-done',
      driveFileId: 'workspace/files/photo.png', createdAt: now, updatedAt: now,
    }],
  }));
});

test('task board actions accept a status change with a Drive photo id and reject a path', () => {
  const statuses = [{ id: 'status-backlog', name: 'Backlog', color: '#64748b', order: 0 }, { id: 'status-done', name: 'Done', color: '#34d399', order: 1 }];
  const action = (driveFileId?: string) => ({
    actionId: 'e1055eb9-cdd7-4942-9a91-5ad3e609ca92', appId: 'tasks', resourceType: 'taskBoard',
    operation: 'update', resourceId: 'main', expectedRevision: 2, payloadVersion: 1, occurredAt: now,
    payload: {
      statuses,
      tasks: [{
        id: 'task-1', title: 'Photo', body: 'See image', statusId: 'status-done',
        ...(driveFileId ? { driveFileId } : {}), createdAt: now, updatedAt: now,
      }],
    },
  });
  assert.equal(actionBatchSchema.safeParse({ actions: [action(PHOTO)] }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [action()] }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [action('../tasks/secret')] }).success, false);
  assert.equal(actionBatchSchema.safeParse({ actions: [action('not-a-uuid')] }).success, false);
});

test('Tasks section photos are raster images under the photo cap', () => {
  assert.equal(taskSectionPhotoError(128, 'image/png'), null);
  assert.equal(taskSectionPhotoError(128, 'image/jpeg'), null);
  assert.match(taskSectionPhotoError(128, 'application/pdf') ?? '', /JPEG/);
  assert.match(taskSectionPhotoError(5 * 1024 * 1024 + 1, 'image/webp') ?? '', /under/);
});
