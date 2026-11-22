import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('emailVerified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('user_email_idx').on(table.email)]
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('session_token_idx').on(table.token),
    index('session_user_id_idx').on(table.userId),
  ]
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('account_provider_account_idx').on(table.providerId, table.accountId),
    index('account_user_id_idx').on(table.userId),
  ]
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)]
)

export const userProfile = pgTable(
  'user_profile',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('user'),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('user_profile_role_idx').on(table.role),
    check('user_profile_role_check', sql`${table.role} in ('user', 'admin')`),
  ]
)

export const model = pgTable('model', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  contextWindow: integer('context_window').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  pricingVersion: text('pricing_version').notNull(),
  inputRate: bigint('input_rate', { mode: 'bigint' }).notNull(),
  outputRate: bigint('output_rate', { mode: 'bigint' }).notNull(),
  reasoningRate: bigint('reasoning_rate', { mode: 'bigint' }).notNull(),
  cachedInputRate: bigint('cached_input_rate', { mode: 'bigint' }).notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [index('model_enabled_idx').on(table.enabled)])

export const creditAccount = pgTable('credit_account', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  available: bigint('available', { mode: 'bigint' }).notNull().default(0n),
  reserved: bigint('reserved', { mode: 'bigint' }).notNull().default(0n),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => [check('credit_account_non_negative_check', sql`${table.available} >= 0 and ${table.reserved} >= 0`)])

export const creditAllocation = pgTable('credit_allocation', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  remaining: bigint('remaining', { mode: 'bigint' }).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex('credit_allocation_idempotency_idx').on(table.userId, table.idempotencyKey), index('credit_allocation_user_idx').on(table.userId)])

export const creditTransaction = pgTable('credit_transaction', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  balanceBefore: bigint('balance_before', { mode: 'bigint' }).notNull(),
  balanceAfter: bigint('balance_after', { mode: 'bigint' }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  reservationId: text('reservation_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex('credit_transaction_idempotency_idx').on(table.userId, table.idempotencyKey), index('credit_transaction_user_created_idx').on(table.userId, table.createdAt)])

export const creditReservation = pgTable('credit_reservation', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  maximum: bigint('maximum', { mode: 'bigint' }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  inferenceRequestId: text('inference_request_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex('credit_reservation_idempotency_idx').on(table.userId, table.idempotencyKey), index('credit_reservation_user_idx').on(table.userId)])

export const schema = { user, session, account, verification, userProfile, model, creditAccount, creditAllocation, creditTransaction, creditReservation }
