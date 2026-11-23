-- WA Manager — D1 schema. Apply with: wrangler d1 execute wa-manager --file=schema.sql
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  webhook_token TEXT NOT NULL UNIQUE,          -- unguessable per-client token in the webhook URL path
  webhook_secret TEXT,                          -- optional shared header value EasyBizy sends
  webhook_secret_header TEXT DEFAULT 'x-webhook-secret',
  connection_status TEXT DEFAULT 'new',
  whatsapp_number TEXT,
  display_name TEXT,
  quality_rating TEXT,
  last_checked_at TEXT,
  last_event_at TEXT,
  events_seen TEXT DEFAULT '[]',                -- JSON array of event keys seen at least once
  notes TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,                   -- keywords | any_message | first_message | event
  keywords TEXT,                                -- comma-separated
  event TEXT,                                   -- e.g. leads.create, appointments.create
  steps TEXT NOT NULL DEFAULT '[]',             -- JSON array of step objects
  window_closed_template TEXT,
  is_live INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bots_client ON bots(client_id);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,                  -- e.g. leads.create, appointments.create
  action TEXT NOT NULL,                         -- send_template | send_text | create_lead | ...
  config TEXT NOT NULL DEFAULT '{}',            -- JSON: template_name, text, note, amount, ...
  handoff_bot_id INTEGER REFERENCES bots(id) ON DELETE SET NULL,  -- optional: if the customer replies, this bot takes over
  is_active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_automations_client ON automations(client_id, trigger_event);

CREATE TABLE IF NOT EXISTS bot_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bot_id INTEGER REFERENCES bots(id) ON DELETE SET NULL,
  contact_phone TEXT NOT NULL,
  customer_name TEXT,
  easybizy_customer_id TEXT,
  status TEXT DEFAULT 'active',                 -- active | waiting | done | handoff
  current_step INTEGER DEFAULT 0,
  branch_value TEXT,                            -- which button branch we are inside
  saved_answers TEXT DEFAULT '{}',              -- JSON
  trigger_data TEXT DEFAULT '{}',               -- JSON of the event payload that started the session
  paused INTEGER DEFAULT 0,
  last_activity_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_contact ON bot_sessions(client_id, contact_phone, status);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES bot_sessions(id) ON DELETE SET NULL,
  contact_phone TEXT NOT NULL,
  customer_name TEXT,
  direction TEXT NOT NULL,                      -- inbound | outbound
  sent_by TEXT,                                 -- bot | team | customer
  content_type TEXT,
  message_text TEXT,
  template_name TEXT,
  delivery_status TEXT DEFAULT 'sent',          -- sent | delivered | failed | received
  easybizy_message_id TEXT,
  error TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(client_id, contact_phone);
CREATE INDEX IF NOT EXISTS idx_messages_ebid ON messages(easybizy_message_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  bot_id INTEGER,
  event_type TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'received',      -- bot_ran | no_bot | failed | ignored
  details TEXT,
  payload TEXT,                                 -- full JSON envelope
  received_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_client ON webhook_events(client_id, received_at);

-- Per-client saved WhatsApp template names ("my templates"): maintained in the app
-- because the client's EasyBizy plan may not allow the templates READ endpoint.
CREATE TABLE IF NOT EXISTS client_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(client_id, name)
);
