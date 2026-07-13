import {
  boolean,
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
