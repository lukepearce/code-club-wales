import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Better Auth core tables (VANILLA) + username plugin columns.
//
// These mirror Better Auth's expected model fields EXACTLY. The Drizzle adapter
// matches Better Auth field names to columns by the table's *property keys*
// (camelCase), so the property keys here must stay camelCase. The SQL column
// names are kept camelCase too, matching `better-auth generate` output.
//
// Do not add domain columns here — domain data lives on crew_member below.
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  // username plugin
  username: text('username').unique(),
  displayUsername: text('displayUsername'),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
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
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// crew_member — the domain table. One row per Better Auth user.
//
// Column *property keys* are snake_case ON PURPOSE: rows read out of this table
// are passed straight to the pure domain modules (admission-gate, organiser-
// policy, reset-window), whose interfaces read member.admitted_at,
// member.is_organiser, member.reset_allowed_until, etc.
//
// NO dob / consent / parent-permission columns ever (ADR 0001).
// ---------------------------------------------------------------------------

export const crewMember = pgTable('crew_member', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  display_name: text('display_name').notNull(),
  is_organiser: boolean('is_organiser').notNull().default(false),
  // NULL = pending (cannot sign in); stamped when the Organiser grants Admission.
  admitted_at: timestamp('admitted_at', { withTimezone: true }),
  // Organiser-opened 5-minute password-reset window; NULL when closed.
  reset_allowed_until: timestamp('reset_allowed_until', { withTimezone: true }),
  // Personal-site slug (claimed + verified later; OUT OF SCOPE for v1 accounts).
  slug: text('slug'),
  slug_claimed_at: timestamp('slug_claimed_at', { withTimezone: true }),
  slug_verified_at: timestamp('slug_verified_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
export type CrewMember = typeof crewMember.$inferSelect;
