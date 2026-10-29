import { randomUUID } from 'node:crypto';
import { claimJob, finishJob, retryJob, type Job } from '@/lib/jobs';
import { updateRelayDelivery } from '@/lib/relay';
import type { RelayChannel, WorkspaceEvent } from '@sorye/types';
import { assertSafeWebhookUrl } from '@/lib/security';

const POLL_MS = 500;
const WORKER_ID = `worker:relay:${randomUUID()}`;
const shutdown = new AbortController();
process.once('SIGTERM', () => shutdown.abort());
process.once('SIGINT', () => shutdown.abort());

function stringField(job: Job, key: string): string {
  const value = job.payload[key];
  if (typeof value !== 'string' || !value) throw new Error(`Invalid Relay job ${key}`);
  return value;
}

async function processJob(job: Job) {
  const workspaceId = stringField(job, 'workspaceId');
  const messageId = stringField(job, 'messageId');
  const channelId = stringField(job, 'channelId');
  const channel = job.payload.channel as RelayChannel;
  const event = job.payload.event as WorkspaceEvent;
  if (!channel || channel.id !== channelId || channel.kind !== 'webhook' ||
      !event || event.workspaceId !== workspaceId || typeof event.id !== 'string') {
    throw new Error('Invalid Relay webhook payload');
  }
  const url = assertSafeWebhookUrl(channel.destination);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': job.id },
      body: JSON.stringify({ source: 'sorye-relay', event }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Webhook responded ${response.status}`);
    await updateRelayDelivery({ workspaceId, messageId, channelId, status: 'sent', detail: `Webhook POST ${response.status} → ${url}` });
    await finishJob(job, { status: 'sent' });
  } finally {
    clearTimeout(timeout);
  }
}

async function run() {
  console.info(`${WORKER_ID} started`);
  while (!shutdown.signal.aborted) {
    try {
      const job = await claimJob('relay');
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        continue;
      }
      try {
        await processJob(job);
      } catch (error) {
        const terminal = job.attempts >= 5;
        if (terminal) {
          const workspaceId = stringField(job, 'workspaceId');
          await updateRelayDelivery({ workspaceId, messageId: stringField(job, 'messageId'),
            channelId: stringField(job, 'channelId'), status: 'failed',
            detail: error instanceof Error ? error.message.slice(0, 240) : 'Webhook delivery failed' });
        }
        await retryJob(job);
      }
    } catch (error) {
      console.error(`${WORKER_ID} queue error`, error);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

void run();
