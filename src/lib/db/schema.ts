import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "@/lib/ids";

/* ---------------------------------------------------------------------------
 * Conventions
 *
 * - Ids are Crockford base32 strings, not autoincrement integers: they appear in
 *   URLs and badge embeds, and must not leak how many monitors exist.
 * - Timestamps are integer epoch-millis with `timestamp_ms` mode, so the app
 *   layer always sees real `Date` objects while SQLite keeps them indexable.
 * - Structured columns (headers, channel config, probe metadata) are JSON text.
 *   SQLite has no JSON type and the shapes are validated by zod at the boundary.
 * ------------------------------------------------------------------------- */

const id = (name = "id") =>
  text(name)
    .primaryKey()
    .$defaultFn(() => newId());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

/* ---------------------------------------------------------------------------
 * Identity
 * ------------------------------------------------------------------------- */

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** scrypt, stored as `scrypt$N$r$p$salt$hash`. See lib/auth/password.ts. */
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    createdAt: createdAt(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the cookie token. A stolen database yields no usable sessions. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invites = sqliteTable(
  "invites",
  {
    id: id(),
    /** SHA-256 of the invite token; the plaintext is shown once, at creation. */
    tokenHash: text("token_hash").notNull(),
    email: text("email"),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedBy: text("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [uniqueIndex("invites_token_unique").on(t.tokenHash)],
);

/* ---------------------------------------------------------------------------
 * Monitors
 * ------------------------------------------------------------------------- */

export const MONITOR_KINDS = ["http", "tcp", "ping", "ssl", "heartbeat"] as const;
export type MonitorKind = (typeof MONITOR_KINDS)[number];

export const monitors = sqliteTable(
  "monitors",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind", { enum: MONITOR_KINDS }).notNull(),

    /**
     * What to probe. Interpretation depends on `kind`:
     *   http      → full URL
     *   tcp       → host:port
     *   ping|ssl  → hostname (ssl accepts an optional :port, default 443)
     *   heartbeat → unused; the job calls us
     */
    target: text("target").notNull().default(""),

    /* -- HTTP options -- */
    method: text("method").notNull().default("GET"),
    /** JSON object of request headers. */
    headers: text("headers"),
    body: text("body"),
    /**
     * Comma-separated acceptable statuses, supporting ranges and wildcards:
     * "200", "200,201,204", "2xx", "200-299".
     */
    expectedStatus: text("expected_status").notNull().default("2xx"),
    keyword: text("keyword"),
    keywordMode: text("keyword_mode", {
      enum: ["contains", "absent", "regex"],
    })
      .notNull()
      .default("contains"),
    followRedirects: integer("follow_redirects", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Off lets you monitor a host whose certificate is knowingly invalid. */
    verifyTls: integer("verify_tls", { mode: "boolean" })
      .notNull()
      .default(true),

    /* -- scheduling -- */
    intervalSec: integer("interval_sec").notNull().default(60),
    timeoutMs: integer("timeout_ms").notNull().default(10_000),
    /**
     * Consecutive failures required before an incident opens. The default of 2
     * costs one interval of detection latency and removes almost all false
     * alarms from transient network blips.
     */
    confirmFailures: integer("confirm_failures").notNull().default(2),
    /** Consecutive successes required before an open incident resolves. */
    confirmRecoveries: integer("confirm_recoveries").notNull().default(2),
    /** Responses slower than this are "degraded": available, but not healthy. */
    degradedMs: integer("degraded_ms"),

    /* -- heartbeat options -- */
    /** Bearer token in the ping URL. Present only for kind = heartbeat. */
    heartbeatToken: text("heartbeat_token"),
    /**
     * How long past the expected interval a job may be late before it is
     * declared dead. Absorbs normal cron jitter and slow runs.
     */
    graceSec: integer("grace_sec").notNull().default(120),

    /* -- ssl options -- */
    /** Days before certificate expiry at which the monitor turns degraded. */
    sslWarnDays: integer("ssl_warn_days").notNull().default(21),

    /* -- objectives -- */
    sloTargetPct: real("slo_target_pct").notNull().default(99.9),

    /* -- state -- */
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    /**
     * Denormalised hot state. The dashboard renders every monitor's current
     * status, and recomputing it from the checks table on each page load would
     * mean one aggregate query per monitor. The scheduler is the only writer.
     */
    lastStatus: text("last_status", {
      enum: ["up", "degraded", "down", "paused", "pending"],
    })
      .notNull()
      .default("pending"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    lastLatencyMs: integer("last_latency_ms"),
    lastError: text("last_error"),
    lastStatusChangedAt: integer("last_status_changed_at", {
      mode: "timestamp_ms",
    }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    consecutiveSuccesses: integer("consecutive_successes").notNull().default(0),
    /** Set by the scheduler so a restart does not stampede every monitor at once. */
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),

    /** JSON array of free-form tags. */
    tags: text("tags"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("monitors_heartbeat_token_unique").on(t.heartbeatToken),
    index("monitors_next_run_idx").on(t.nextRunAt),
    index("monitors_paused_idx").on(t.paused),
  ],
);

/* ---------------------------------------------------------------------------
 * Check results
 * ------------------------------------------------------------------------- */

export const checks = sqliteTable(
  "checks",
  {
    id: id(),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    status: text("status", { enum: ["up", "degraded", "down"] }).notNull(),
    latencyMs: integer("latency_ms"),
    httpStatus: integer("http_status"),
    error: text("error"),
    /** Probe-specific detail: cert expiry, resolved IP, redirect chain, body size. */
    meta: text("meta"),
  },
  (t) => [
    // The dominant access pattern is "latest N for one monitor" and "window for
    // one monitor", both served by this composite in descending time order.
    index("checks_monitor_at_idx").on(t.monitorId, t.at),
  ],
);

/**
 * Pre-aggregated buckets. A 90-day status page over 60-second checks would touch
 * ~130k rows per monitor; rollups turn that into 90. Written by the scheduler,
 * and the raw checks behind them are pruned by retention.
 */
export const rollups = sqliteTable(
  "rollups",
  {
    id: id(),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    bucket: text("bucket", { enum: ["hour", "day"] }).notNull(),
    /** Bucket start, floored to the bucket size in UTC. */
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    total: integer("total").notNull().default(0),
    upCount: integer("up_count").notNull().default(0),
    degradedCount: integer("degraded_count").notNull().default(0),
    downCount: integer("down_count").notNull().default(0),
    avgMs: real("avg_ms"),
    p50Ms: integer("p50_ms"),
    p95Ms: integer("p95_ms"),
    p99Ms: integer("p99_ms"),
    minMs: integer("min_ms"),
    maxMs: integer("max_ms"),
    downtimeMs: integer("downtime_ms").notNull().default(0),
  },
  (t) => [
    uniqueIndex("rollups_key_unique").on(t.monitorId, t.bucket, t.startedAt),
    index("rollups_lookup_idx").on(t.monitorId, t.bucket, t.startedAt),
  ],
);

/* ---------------------------------------------------------------------------
 * Incidents
 * ------------------------------------------------------------------------- */

export const incidents = sqliteTable(
  "incidents",
  {
    id: id(),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["open", "acknowledged", "resolved"] })
      .notNull()
      .default("open"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    /** Error text from the check that opened the incident. */
    cause: text("cause"),
    /** How many consecutive failures had accumulated when it opened. */
    failedChecks: integer("failed_checks").notNull().default(1),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp_ms" }),
    acknowledgedBy: text("acknowledged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Set when the monitor crossed the flap threshold — repeated open/resolve
     * cycles in a short window. Flapping incidents stop re-notifying so an
     * unstable endpoint cannot page someone twenty times an hour.
     */
    flapping: integer("flapping", { mode: "boolean" }).notNull().default(false),
    /** True when alerts were suppressed by a maintenance window. */
    suppressed: integer("suppressed", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("incidents_monitor_idx").on(t.monitorId, t.startedAt),
    index("incidents_status_idx").on(t.status),
  ],
);

export const INCIDENT_EVENT_KINDS = [
  "opened",
  "acknowledged",
  "comment",
  "escalated",
  "flapping",
  "recovered",
  "resolved",
  "suppressed",
  "notified",
  "notify_failed",
] as const;

export const incidentEvents = sqliteTable(
  "incident_events",
  {
    id: id(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    kind: text("kind", { enum: INCIDENT_EVENT_KINDS }).notNull(),
    message: text("message"),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    meta: text("meta"),
  },
  (t) => [index("incident_events_incident_idx").on(t.incidentId, t.at)],
);

/* ---------------------------------------------------------------------------
 * Notification channels
 * ------------------------------------------------------------------------- */

export const CHANNEL_KINDS = ["webhook", "telegram"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const channels = sqliteTable("channels", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind", { enum: CHANNEL_KINDS }).notNull(),
  /** Kind-specific JSON, validated by the matching zod schema in lib/notify. */
  config: text("config").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** Notify on recovery as well as failure. Some sinks only want the bad news. */
  notifyOnRecovery: integer("notify_on_recovery", { mode: "boolean" })
    .notNull()
    .default(true),
  notifyOnDegraded: integer("notify_on_degraded", { mode: "boolean" })
    .notNull()
    .default(false),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

export const monitorChannels = sqliteTable(
  "monitor_channels",
  {
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.monitorId, t.channelId] }),
    index("monitor_channels_channel_idx").on(t.channelId),
  ],
);

/** Delivery log. Answers "did the alert actually go out?" after the fact. */
export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    monitorId: text("monitor_id").references(() => monitors.id, {
      onDelete: "cascade",
    }),
    incidentId: text("incident_id").references(() => incidents.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", {
      enum: ["opened", "resolved", "degraded", "acknowledged", "test"],
    }).notNull(),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    attempts: integer("attempts").notNull().default(1),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    error: text("error"),
  },
  (t) => [
    index("notifications_incident_idx").on(t.incidentId),
    index("notifications_at_idx").on(t.at),
  ],
);

/* ---------------------------------------------------------------------------
 * Status pages
 * ------------------------------------------------------------------------- */

export const statusPages = sqliteTable(
  "status_pages",
  {
    id: id(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** Unpublished pages 404 for the public but stay previewable when signed in. */
    published: integer("published", { mode: "boolean" })
      .notNull()
      .default(false),
    showGrades: integer("show_grades", { mode: "boolean" })
      .notNull()
      .default(true),
    showLatency: integer("show_latency", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Days of history in the uptime tape. */
    historyDays: integer("history_days").notNull().default(90),
    contactUrl: text("contact_url"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("status_pages_slug_unique").on(t.slug)],
);

export const statusPageItems = sqliteTable(
  "status_page_items",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => statusPages.id, { onDelete: "cascade" }),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /** Public-facing name, so internal monitor names can stay blunt. */
    displayName: text("display_name"),
    groupName: text("group_name"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("status_page_items_unique").on(t.pageId, t.monitorId),
    index("status_page_items_page_idx").on(t.pageId, t.sortOrder),
  ],
);

/* ---------------------------------------------------------------------------
 * Maintenance windows
 * ------------------------------------------------------------------------- */

export const maintenanceWindows = sqliteTable(
  "maintenance_windows",
  {
    id: id(),
    title: text("title").notNull(),
    notes: text("notes"),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
    /** Keep probing but withhold alerts — the usual choice, since you still
     *  want the data for the timeline afterwards. */
    suppressAlerts: integer("suppress_alerts", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Stop probing entirely for the duration. */
    pauseChecks: integer("pause_checks", { mode: "boolean" })
      .notNull()
      .default(false),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("maintenance_window_range_idx").on(t.startsAt, t.endsAt)],
);

export const maintenanceMonitors = sqliteTable(
  "maintenance_monitors",
  {
    windowId: text("window_id")
      .notNull()
      .references(() => maintenanceWindows.id, { onDelete: "cascade" }),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.windowId, t.monitorId] }),
    index("maintenance_monitors_monitor_idx").on(t.monitorId),
  ],
);

/* ---------------------------------------------------------------------------
 * Key/value settings
 * ------------------------------------------------------------------------- */

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ---------------------------------------------------------------------------
 * Relations
 * ------------------------------------------------------------------------- */

export const monitorsRelations = relations(monitors, ({ many, one }) => ({
  checks: many(checks),
  incidents: many(incidents),
  rollups: many(rollups),
  channels: many(monitorChannels),
  statusPageItems: many(statusPageItems),
  creator: one(users, {
    fields: [monitors.createdBy],
    references: [users.id],
  }),
}));

export const checksRelations = relations(checks, ({ one }) => ({
  monitor: one(monitors, {
    fields: [checks.monitorId],
    references: [monitors.id],
  }),
}));

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  monitor: one(monitors, {
    fields: [incidents.monitorId],
    references: [monitors.id],
  }),
  events: many(incidentEvents),
  notifications: many(notifications),
  acknowledger: one(users, {
    fields: [incidents.acknowledgedBy],
    references: [users.id],
  }),
}));

export const incidentEventsRelations = relations(incidentEvents, ({ one }) => ({
  incident: one(incidents, {
    fields: [incidentEvents.incidentId],
    references: [incidents.id],
  }),
  actor: one(users, {
    fields: [incidentEvents.actorId],
    references: [users.id],
  }),
}));

export const channelsRelations = relations(channels, ({ many }) => ({
  monitors: many(monitorChannels),
  notifications: many(notifications),
}));

export const monitorChannelsRelations = relations(
  monitorChannels,
  ({ one }) => ({
    monitor: one(monitors, {
      fields: [monitorChannels.monitorId],
      references: [monitors.id],
    }),
    channel: one(channels, {
      fields: [monitorChannels.channelId],
      references: [channels.id],
    }),
  }),
);

export const statusPagesRelations = relations(statusPages, ({ many }) => ({
  items: many(statusPageItems),
}));

export const statusPageItemsRelations = relations(
  statusPageItems,
  ({ one }) => ({
    page: one(statusPages, {
      fields: [statusPageItems.pageId],
      references: [statusPages.id],
    }),
    monitor: one(monitors, {
      fields: [statusPageItems.monitorId],
      references: [monitors.id],
    }),
  }),
);

export const maintenanceWindowsRelations = relations(
  maintenanceWindows,
  ({ many }) => ({
    monitors: many(maintenanceMonitors),
  }),
);

export const maintenanceMonitorsRelations = relations(
  maintenanceMonitors,
  ({ one }) => ({
    window: one(maintenanceWindows, {
      fields: [maintenanceMonitors.windowId],
      references: [maintenanceWindows.id],
    }),
    monitor: one(monitors, {
      fields: [maintenanceMonitors.monitorId],
      references: [monitors.id],
    }),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

/* ---------------------------------------------------------------------------
 * Inferred types
 * ------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Monitor = typeof monitors.$inferSelect;
export type NewMonitor = typeof monitors.$inferInsert;
export type Check = typeof checks.$inferSelect;
export type Rollup = typeof rollups.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type IncidentEvent = typeof incidentEvents.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type StatusPage = typeof statusPages.$inferSelect;
export type StatusPageItem = typeof statusPageItems.$inferSelect;
export type MaintenanceWindow = typeof maintenanceWindows.$inferSelect;

/** Re-exported so callers can build raw SQL fragments without a second import. */
export { sql };
