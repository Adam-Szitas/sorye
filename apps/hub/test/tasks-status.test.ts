import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultTasksBoard, findTaskByTicketId, isTaskDriveFileId, TASK_ATTACHMENT_MAX, TASK_PHOTO_MAX_BYTES, ticketIdFromInput } from '@sorye/types';
import { actionBatchSchema } from '../lib/rodrigo/action-validation';
import { taskSectionPhotoError } from '../lib/files';
import { parseTasksBoard } from '../lib/workspace-docs-validate';
import { allocateTaskId, StatusHandler } from '../../tasks/src/status-handler';
import { takeTaskImages } from '../../tasks/src/task-photo';

const PHOTO = '3f1c2c2a-6a4e-4b1a-8c3d-9a0b1c2d3e4f';
const PHOTO_2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const now = '2026-11-09T12:00:00.000Z';

test('moving a task keeps its label, description, and images and does not fall back to backlog', () => {
  const board = createDefaultTasksBoard();
  const source = board.tasks.find((task) => task.statusId === 'status-backlog');
  const other = board.tasks.find((task) => task.id !== source?.id);
  assert.ok(source);
  assert.ok(other);
  const otherStatus = other.statusId;
  const legacy = {
    ...board,
    tasks: board.tasks.map((task) => task.id === source.id ? { ...task, driveFileId: PHOTO } : task),
  };
  const moved = new StatusHandler(legacy).moveTaskToStatus(source.id, 'status-done');
  const afterMove = moved.getBoard().tasks.find((task) => task.id === source.id);
  assert.ok(afterMove);
  assert.equal(afterMove.statusId, 'status-done');
  assert.equal(afterMove.title, source.title);
  assert.equal(afterMove.body, source.body);
  assert.deepEqual(afterMove.attachmentIds, [PHOTO]);
  assert.equal(Object.hasOwn(afterMove, 'driveFileId'), false);
  assert.equal(moved.getBoard().tasks.find((task) => task.id === other.id)?.statusId, otherStatus);

  const edited = moved.updateTask(source.id, { title: 'Renamed', body: 'With notes', attachmentIds: [PHOTO, PHOTO_2] });
  const afterEdit = edited.getBoard().tasks.find((task) => task.id === source.id);
  assert.ok(afterEdit);
  assert.equal(afterEdit.statusId, 'status-done');
  assert.equal(afterEdit.title, 'Renamed');
  assert.equal(afterEdit.body, 'With notes');
  assert.deepEqual(afterEdit.attachmentIds, [PHOTO, PHOTO_2]);
  assert.equal(edited.getBoard().tasks.find((task) => task.id === other.id)?.statusId, otherStatus);

  const shifted = edited.moveTaskToStatus(source.id, 'status-review');
  const afterShift = shifted.getBoard().tasks.find((task) => task.id === source.id);
  assert.ok(afterShift);
  assert.equal(afterShift.statusId, 'status-review');
  assert.equal(afterShift.title, 'Renamed');
  assert.deepEqual(afterShift.attachmentIds, [PHOTO, PHOTO_2]);

  const keptStatus = shifted.updateTask(source.id, { title: 'Still review', statusId: 'missing-status' });
  assert.equal(keptStatus.getBoard().tasks.find((task) => task.id === source.id)?.statusId, 'status-review');

  const cleared = shifted.updateTask(source.id, { attachmentIds: undefined });
  const afterClear = cleared.getBoard().tasks.find((task) => task.id === source.id);
  assert.ok(afterClear);
  assert.equal(afterClear.statusId, 'status-review');
  assert.equal(Object.hasOwn(afterClear, 'attachmentIds'), false);
  assert.equal(Object.hasOwn(afterClear, 'driveFileId'), false);
});

test('new task ids are unique on the workspace board', () => {
  const existing = new Set(['task-aaaaaaaa']);
  let calls = 0;
  const id = allocateTaskId(existing, () => {
    calls += 1;
    return calls === 1 ? 'aaaaaaaa-1111-4111-8111-111111111111' : 'bbbbbbbb-2222-4222-8222-222222222222';
  });
  assert.equal(id, 'task-bbbbbbbb');
  const board = new StatusHandler(createDefaultTasksBoard()).addTask('One').addTask('Two').getBoard();
  const ids = board.tasks.map((task) => task.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a ticket opens only by its exact id in this workspace', () => {
  const board = createDefaultTasksBoard();
  const task = board.tasks[0];
  assert.ok(task);
  assert.equal(ticketIdFromInput(`https://hub.example/apps/tasks?workspace=other&ticket=${task.id}`), task.id);
  assert.equal(ticketIdFromInput('https://hub.example/apps/tasks?workspace=other'), '');
  assert.equal(findTaskByTicketId(board.tasks, task.id)?.id, task.id);
  assert.equal(findTaskByTicketId(board.tasks, `/apps/tasks?ticket=${encodeURIComponent(task.id)}`)?.title, task.title);
  assert.equal(findTaskByTicketId(board.tasks, 'task-does-not-exist'), undefined);
  assert.equal(findTaskByTicketId(board.tasks, task.id.slice(0, -1)), undefined);
  assert.equal(findTaskByTicketId([task, { ...task }], task.id), undefined);
});

test('pasted images are bounded Drive references and non-images are rejected', () => {
  const png = new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' });
  const pdf = new File([new Uint8Array(8)], 'notes.pdf', { type: 'application/pdf' });
  const big = new File([new Uint8Array(TASK_PHOTO_MAX_BYTES + 1)], 'big.png', { type: 'image/png' });
  assert.equal(takeTaskImages(0, [png, png]).accepted.length, 2);
  assert.match(takeTaskImages(0, [pdf]).error ?? '', /JPEG/);
  assert.equal(takeTaskImages(0, [pdf]).accepted.length, 0);
  assert.match(takeTaskImages(0, [big]).error ?? '', /under/);
  assert.match(takeTaskImages(TASK_ATTACHMENT_MAX, [png]).error ?? '', /8/);
  assert.equal(takeTaskImages(TASK_ATTACHMENT_MAX - 1, [png]).accepted.length, 1);
});

test('task board reads keep a real status and Drive image ids', () => {
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
  assert.deepEqual(parsed.tasks[0]?.attachmentIds, [PHOTO]);
  assert.equal(Object.hasOwn(parsed.tasks[0] ?? {}, 'driveFileId'), false);
  const several = parseTasksBoard({
    statuses: createDefaultTasksBoard().statuses,
    tasks: [{
      id: 'task-1', title: 'Photo', body: 'See image', statusId: 'status-review',
      attachmentIds: [PHOTO, PHOTO_2], createdAt: now, updatedAt: now,
    }],
  });
  assert.equal(several.tasks[0]?.statusId, 'status-review');
  assert.deepEqual(several.tasks[0]?.attachmentIds, [PHOTO, PHOTO_2]);
  assert.throws(() => parseTasksBoard({
    statuses: createDefaultTasksBoard().statuses,
    tasks: [{
      id: 'task-1', title: 'Photo', body: '', statusId: 'status-done',
      driveFileId: 'workspace/files/photo.png', createdAt: now, updatedAt: now,
    }],
  }));
  assert.throws(() => parseTasksBoard({
    statuses: createDefaultTasksBoard().statuses,
    tasks: [{
      id: 'task-1', title: 'Photo', body: '', statusId: 'status-done',
      driveFileId: PHOTO, attachmentIds: [PHOTO], createdAt: now, updatedAt: now,
    }],
  }));
  assert.throws(() => parseTasksBoard({
    statuses: createDefaultTasksBoard().statuses,
    tasks: [
      { id: 'task-1', title: 'One', body: '', statusId: 'status-done', createdAt: now, updatedAt: now },
      { id: 'task-1', title: 'Two', body: '', statusId: 'status-done', createdAt: now, updatedAt: now },
    ],
  }));
});

test('task board actions accept image ids and reject a path or two image fields', () => {
  const statuses = [{ id: 'status-backlog', name: 'Backlog', color: '#64748b', order: 0 }, { id: 'status-done', name: 'Done', color: '#34d399', order: 1 }];
  const action = (images: Record<string, unknown>) => ({
    actionId: 'e1055eb9-cdd7-4942-9a91-5ad3e609ca92', appId: 'tasks', resourceType: 'taskBoard',
    operation: 'update', resourceId: 'main', expectedRevision: 2, payloadVersion: 1, occurredAt: now,
    payload: {
      statuses,
      tasks: [{
        id: 'task-1', title: 'Photo', body: 'See image', statusId: 'status-done',
        ...images, createdAt: now, updatedAt: now,
      }],
    },
  });
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ driveFileId: PHOTO })] }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ attachmentIds: [PHOTO, PHOTO_2] })] }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({})] }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ driveFileId: '../tasks/secret' })] }).success, false);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ attachmentIds: ['not-a-uuid'] })] }).success, false);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ driveFileId: PHOTO, attachmentIds: [PHOTO] })] }).success, false);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ attachmentIds: Array.from({ length: TASK_ATTACHMENT_MAX + 1 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`) })] }).success, false);
});

test('Tasks section photos are raster images under the photo cap', () => {
  assert.equal(taskSectionPhotoError(128, 'image/png'), null);
  assert.equal(taskSectionPhotoError(128, 'image/jpeg'), null);
  assert.match(taskSectionPhotoError(128, 'application/pdf') ?? '', /JPEG/);
  assert.match(taskSectionPhotoError(5 * 1024 * 1024 + 1, 'image/webp') ?? '', /under/);
});
