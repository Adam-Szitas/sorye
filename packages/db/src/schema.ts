import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const subscriptionTierEnum = pgEnum('subscription_tier', [
  'free',
  'starter',
  'pro',
  'enterprise',
]);

/** Shared feature state. Scope is a server-derived workspace ID, or @global for platform state. */
export const sharedState = pgTable('shared_state', {
  namespace: text('namespace').notNull(),
  scope: text('scope').notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('shared_state_namespace_scope').on(table.namespace, table.scope)]);

export const backgroundJobs = pgTable('background_jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('queued'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  attempts: integer('attempts').notNull().default(0),
  leaseOwner: text('lease_owner'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
}, (t) => [index('background_jobs_claim_idx').on(t.kind, t.status, t.availableAt),
  index('background_jobs_workspace_idx').on(t.workspaceId, t.createdAt)]);

export const subscriptionSourceEnum = pgEnum('subscription_source', [
  'admin',
  'stripe',
]);

export const workspaceKindEnum = pgEnum('workspace_kind', ['personal', 'team']);

export const connectionStatusEnum = pgEnum('connection_status', [
  'active',
  'pending',
  'error',
]);

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  image: text('image'),
  personalWorkspaceId: text('personal_workspace_id').notNull(),
  activeWorkspaceId: text('active_workspace_id').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  kind: workspaceKindEnum('kind').notNull(),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  subscriptionId: subscriptionTierEnum('subscription_id').notNull(),
  subscriptionSource: subscriptionSourceEnum('subscription_source').notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  selectedAppIds: jsonb('selected_app_ids').$type<string[]>().notNull(),
  storageDriver: text('storage_driver').notNull().default('default'),
  storageStatus: text('storage_status').notNull().default('default'),
  storageHostHint: text('storage_host_hint'),
  storageDatabaseHint: text('storage_database_hint'),
  storageLastError: text('storage_last_error'),
  databaseUrlEncrypted: text('database_url_encrypted'),
  storageUpdatedAt: timestamp('storage_updated_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_members_pk').on(table.workspaceId, table.userId),
  ],
);

export const connectedApps = pgTable('connected_apps', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  endpoint: text('endpoint').notNull(),
  apiKeyHint: text('api_key_hint').notNull(),
  apiKeyEncrypted: text('api_key_encrypted'),
  status: connectionStatusEnum('status').notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const embedWidgets = pgTable('embed_widgets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyHint: text('key_hint').notNull(),
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull(),
  enabledAppIds: jsonb('enabled_app_ids').$type<string[]>().notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const messengerChannels = pgTable('messenger_channels', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  memberIds: jsonb('member_ids').$type<string[]>().notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [index('messenger_channels_workspace_idx').on(table.workspaceId)]);

export const messengerMessages = pgTable('messenger_messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => messengerChannels.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  text: text('text'),
  imageDataUrl: text('image_data_url'),
  imageBytes: integer('image_bytes'),
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
  author: jsonb('author')
    .$type<{ id: string; name: string; image?: string }>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [index('messenger_messages_channel_created_id_idx').on(table.channelId, table.createdAt, table.id)]);

export const canvasBoards = pgTable('canvas_boards', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  updatedBy: text('updated_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  revision: integer('revision').notNull().default(1),
  document: jsonb('document').$type<{
    items: unknown[];
    viewport?: { x: number; y: number; zoom: number };
  }>().notNull(),
});

/** One durable document per workspace for Tasks, Notes, or Calendar. */
export const workspaceAppDocs = pgTable(
  'workspace_app_docs',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [
    uniqueIndex('workspace_app_docs_pk').on(table.workspaceId, table.kind),
  ],
);

/**
 * One Qwen reading of a PDF: row transcript plus pattern JSON.
 * The PDF bytes themselves are not stored.
 */
export const ocrAnalyses = pgTable(
  'ocr_analyses',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    fileName: text('file_name').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    pages: jsonb('pages')
      .$type<Array<{ page: number; rows: string[] }>>()
      .notNull(),
    /** Page offsets for the flat line vector. Line text stays in `pages`. */
    vector: jsonb('vector').$type<{
      version: 1;
      pageStarts: number[];
      lineCount: number;
      notes: Array<{ page: number; complete: boolean; warning: string | null }>;
      cursor?: { next: number; total: number; missed: number };
      gpuStartedAt?: string;
      gpuFinishedAt?: string;
    } | null>(),
    pattern: jsonb('pattern').$type<Record<string, unknown> | null>(),
    error: text('error'),
    /** Model-loop start. Null when inference never ran. */
    workStartedAt: timestamp('work_started_at', { withTimezone: true }),
    /** Set when status leaves `extracting`. */
    workFinishedAt: timestamp('work_finished_at', { withTimezone: true }),
    /** Accumulated model time. Null when inference never ran. */
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('ocr_analyses_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

/**
 * Customer-owned upload storage per workspace ("Connect your drive" / "Connect your database").
 * Credentials are AES-256-GCM ciphertexts bound to the workspace (STORAGE_SECRET_KEY); never returned.
 */
export const workspaceUploadStorage = pgTable('workspace_upload_storage', {
  workspaceId: text('workspace_id').primaryKey(),
  /** sorye | drive | database */
  target: text('target').notNull().default('sorye'),
  /** Non-secret drive settings (provider, bucket, region, endpoint, prefix, limit, status). */
  drive: jsonb('drive').$type<Record<string, unknown> | null>(),
  driveSecretEncrypted: text('drive_secret_encrypted'),
  /** Non-secret database settings (host, port, database, user, schema, TLS mode, limit, status). */
  database: jsonb('database').$type<Record<string, unknown> | null>(),
  databaseSecretEncrypted: text('database_secret_encrypted'),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Every upload of a workspace, whatever its destination. Kept after the file is deleted. */
export const uploadLedger = pgTable(
  'upload_ledger',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    fileId: text('file_id'),
    userId: text('user_id').notNull(),
    target: text('target').notNull(),
    location: text('location'),
    displayName: text('display_name').notNull(),
    mime: text('mime'),
    size: bigint('size', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    sourceAppId: text('source_app_id').notNull(),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('upload_ledger_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('upload_ledger_workspace_target_status_idx').on(table.workspaceId, table.target, table.status),
    index('upload_ledger_file_idx').on(table.fileId),
  ],
);
