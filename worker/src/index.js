/* WA Manager worker: admin API for the static console + EasyBizy webhook receiver.
   Routes:
     POST /hook/:token            — EasyBizy webhook (per-client unguessable token)
     POST /api/login              — console password check
     POST /api/auth/google       — Google ID-token sign-in (allowlisted emails only)
     /api/* (Bearer session token) — clients, bots, automations, conversations, activity
   Secrets live only here (D1 + worker secrets); the public static site holds none. */
import * as eb from './easybizy.js';
import { handleEvent, runAutomations } from './engine.js';

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  };
}

const maskKey = (k) => (k ? k.slice(0, 8) + '••••••••' + k.slice(-4) : null);
const clientOut = (c) => c && ({
  id: c.id, name: c.name, api_key_masked: maskKey(c.api_key), api_secret_set: !!c.api_secret,
  webhook_token: c.webhook_token, webhook_secret_set: !!c.webhook_secret,
  connection_status: c.connection_status, whatsapp_number: c.whatsapp_number,
  display_name: c.display_name, quality_rating: c.quality_rating,
  last_checked_at: c.last_checked_at, last_event_at: c.last_event_at,
  events_seen: JSON.parse(c.events_seen || '[]'), notes: c.notes, created_at: c.created_at,
});

/* --- Google sign-in: verify the ID token signature against Google's keys,
       then allow only emails from ALLOWED_EMAILS (server-side allowlist). --- */
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
let jwksCache = { at: 0, keys: [] };

async function verifyGoogleToken(credential, env) {
  const [h, p, s] = String(credential || '').split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) return null;
  if (!env.GOOGLE_CLIENT_ID || payload.aud !== env.GOOGLE_CLIENT_ID) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  if (Date.now() - jwksCache.at > 3600_000) {
    jwksCache = { at: Date.now(), keys: (await (await fetch('https://www.googleapis.com/oauth2/v3/certs')).json()).keys || [] };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok || payload.email_verified !== true) return null;
  const allowed = (env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(String(payload.email || '').toLowerCase())) return null;
  return payload;
}

async function issueSession(env, email) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(`INSERT INTO auth_sessions (token, email, expires_at) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))`).bind(token, email).run();
  return token;
}

async function requireAuth(req, env) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const row = await env.DB.prepare(`SELECT token FROM auth_sessions WHERE token=? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(token).first();
  return !!row;
}

async function getClient(env, id) {
  return env.DB.prepare(`SELECT * FROM clients WHERE id=?`).bind(id).first();
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    const withCors = (res) => { for (const [k, v] of Object.entries(cors(env))) res.headers.set(k, v); return res; };

    try {
      /* ---------- webhook receiver ---------- */
      const hookMatch = path.match(/^\/hook\/([A-Za-z0-9_-]+)$/);
      if (hookMatch && req.method === 'POST') {
        const client = await env.DB.prepare(`SELECT * FROM clients WHERE webhook_token=?`).bind(hookMatch[1]).first();
        if (!client) return withCors(json({ error: 'unknown endpoint' }, 404));
        if (client.webhook_secret) {
          const got = req.headers.get(client.webhook_secret_header || 'x-webhook-secret');
          if (got !== client.webhook_secret) return withCors(json({ error: 'bad secret' }, 401));
        }
        const envelope = await req.json().catch(() => null);
        if (!envelope || !envelope.resource) return withCors(json({ error: 'bad payload' }, 400));
        const eventType = `${envelope.resource}.${envelope.action}`;

        let outcome = { result: 'ignored', details: '' };
        try {
          outcome = await handleEvent(env, client, envelope);
          const autoDetails = await runAutomations(env, client, envelope);
          if (autoDetails) {
            outcome.details = [outcome.details, `אוטומציות: ${autoDetails}`].filter(Boolean).join(' · ');
            if (outcome.result === 'ignored' || outcome.result === 'no_bot') outcome.result = 'automation_ran';
          }
        } catch (err) {
          outcome = { result: 'failed', details: String(err.message || err) };
        }
        const seen = new Set(JSON.parse(client.events_seen || '[]'));
        seen.add(eventType);
        await env.DB.prepare(`INSERT INTO webhook_events (client_id, event_type, result, details, payload) VALUES (?,?,?,?,?)`)
          .bind(client.id, eventType, outcome.result, outcome.details, JSON.stringify(envelope)).run();
        await env.DB.prepare(`UPDATE clients SET last_event_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), events_seen=? WHERE id=?`)
          .bind(JSON.stringify([...seen]), client.id).run();
        return withCors(json({ ok: true, ...outcome }));
      }

      /* ---------- admin API ---------- */
      if (path === '/api/health') return withCors(json({ ok: true }));
      if (path === '/api/auth/google' && req.method === 'POST') {
        const { credential } = await req.json().catch(() => ({}));
        const payload = await verifyGoogleToken(credential, env).catch(() => null);
        if (!payload) return withCors(json({ error: 'unauthorized' }, 401));
        const token = await issueSession(env, payload.email);
        return withCors(json({ ok: true, token, email: payload.email }));
      }
      if (!(await requireAuth(req, env))) return withCors(json({ error: 'unauthorized' }, 401));

      const body = ['POST', 'PATCH'].includes(req.method) ? await req.json().catch(() => ({})) : {};

      /* clients */
      if (path === '/api/clients' && req.method === 'GET') {
        const rows = (await env.DB.prepare(`
          SELECT c.*, (SELECT COUNT(*) FROM bots b WHERE b.client_id=c.id AND b.is_live=1) AS active_bots
          FROM clients c ORDER BY c.name`).all()).results;
        return withCors(json({ clients: rows.map(r => ({ ...clientOut(r), active_bots: r.active_bots })) }));
      }
      if (path === '/api/clients' && req.method === 'POST') {
        if (!body.name || !body.api_key || !body.api_secret) return withCors(json({ error: 'missing fields' }, 400));
        const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const r = await env.DB.prepare(`INSERT INTO clients (name, api_key, api_secret, webhook_token, notes) VALUES (?,?,?,?,?)`)
          .bind(body.name, body.api_key, body.api_secret, token, body.notes || null).run();
        return withCors(json({ client: clientOut(await getClient(env, r.meta.last_row_id)) }));
      }
      const cm = path.match(/^\/api\/clients\/(\d+)(\/(test|templates|bots|automations|conversations))?$/);
      if (cm) {
        const client = await getClient(env, cm[1]);
        if (!client) return withCors(json({ error: 'not found' }, 404));
        const sub = cm[3];

        if (!sub && req.method === 'GET') return withCors(json({ client: clientOut(client) }));
        if (!sub && req.method === 'PATCH') {
          await env.DB.prepare(`UPDATE clients SET name=COALESCE(?,name), api_key=COALESCE(?,api_key), api_secret=COALESCE(?,api_secret), webhook_secret=COALESCE(?,webhook_secret), notes=COALESCE(?,notes) WHERE id=?`)
            .bind(body.name ?? null, body.api_key ?? null, body.api_secret ?? null, body.webhook_secret ?? null, body.notes ?? null, client.id).run();
          return withCors(json({ client: clientOut(await getClient(env, client.id)) }));
        }
        if (!sub && req.method === 'DELETE') {
          await env.DB.prepare(`DELETE FROM clients WHERE id=?`).bind(client.id).run();
          return withCors(json({ ok: true }));
        }
        if (sub === 'test' && req.method === 'POST') {
          try {
            await eb.ping(client);
            let number = null, quality = null, balance = null;
            try {
              const acc = await eb.whatsappAccount(client);
              const a = acc.account || acc;
              number = a.phoneNumber || a.number || null;
              quality = a.qualityRating || a.quality || null;
              balance = a.balance || a.sendingBalance || null;
            } catch { /* whatsapp account may not exist yet */ }
            await env.DB.prepare(`UPDATE clients SET connection_status='connected', whatsapp_number=COALESCE(?,whatsapp_number), quality_rating=COALESCE(?,quality_rating), last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
              .bind(number, quality, client.id).run();
            return withCors(json({ ok: true, whatsapp_number: number, quality_rating: quality, balance }));
          } catch (err) {
            await env.DB.prepare(`UPDATE clients SET connection_status=?, last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
              .bind(err.status === 401 || err.status === 403 ? 'key_rejected' : 'error', client.id).run();
            return withCors(json({ ok: false, error: String(err.message || err) }));
          }
        }
        if (sub === 'templates' && req.method === 'GET') {
          try {
            const data = await eb.templates(client, url.searchParams.get('language') || 'he');
            return withCors(json({ templates: data.templates || data || [] }));
          } catch (err) {
            // e.g. the client's EasyBizy plan lacks template read access; the UI falls
            // back to typing a template name manually.
            return withCors(json({ templates: [], templates_error: String(err.message || err) }));
          }
        }
        if (sub === 'bots' && req.method === 'GET') {
          const rows = (await env.DB.prepare(`
            SELECT b.*, (SELECT COUNT(*) FROM bot_sessions s WHERE s.bot_id=b.id AND s.started_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) AS runs_week
            FROM bots b WHERE b.client_id=? ORDER BY b.id`).bind(client.id).all()).results;
          return withCors(json({ bots: rows.map(b => ({ ...b, steps: JSON.parse(b.steps || '[]'), is_live: !!b.is_live })) }));
        }
        if (sub === 'bots' && req.method === 'POST') {
          const r = await env.DB.prepare(`INSERT INTO bots (client_id, name, trigger_type, keywords, event, steps, window_closed_template, is_live) VALUES (?,?,?,?,?,?,?,?)`)
            .bind(client.id, body.name, body.trigger_type, body.keywords || null, body.event || null,
              JSON.stringify(body.steps || []), body.window_closed_template || null, body.is_live ? 1 : 0).run();
          return withCors(json({ bot: { id: r.meta.last_row_id, ...body } }));
        }
        if (sub === 'automations' && req.method === 'GET') {
          const rows = (await env.DB.prepare(`SELECT * FROM automations WHERE client_id=? ORDER BY id`).bind(client.id).all()).results;
          return withCors(json({ automations: rows.map(a => ({ ...a, config: JSON.parse(a.config || '{}'), is_active: !!a.is_active })) }));
        }
        if (sub === 'automations' && req.method === 'POST') {
          const r = await env.DB.prepare(`INSERT INTO automations (client_id, name, trigger_event, action, config, handoff_bot_id, is_active) VALUES (?,?,?,?,?,?,?)`)
            .bind(client.id, body.name, body.trigger_event, body.action, JSON.stringify(body.config || {}),
              body.handoff_bot_id || null, body.is_active ? 1 : 0).run();
          return withCors(json({ automation: { id: r.meta.last_row_id, ...body } }));
        }
        if (sub === 'conversations' && req.method === 'GET') {
          const rows = (await env.DB.prepare(`
            SELECT s.*, b.name AS bot_name,
              (SELECT message_text FROM messages m WHERE m.client_id=s.client_id AND m.contact_phone=s.contact_phone ORDER BY m.id DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages m WHERE m.client_id=s.client_id AND m.contact_phone=s.contact_phone ORDER BY m.id DESC LIMIT 1) AS last_at
            FROM bot_sessions s LEFT JOIN bots b ON b.id=s.bot_id
            WHERE s.client_id=? ORDER BY s.last_activity_at DESC LIMIT 100`).bind(client.id).all()).results;
          return withCors(json({ conversations: rows }));
        }
      }

      /* bots */
      const bm = path.match(/^\/api\/bots\/(\d+)(\/duplicate)?$/);
      if (bm) {
        const bot = await env.DB.prepare(`SELECT * FROM bots WHERE id=?`).bind(bm[1]).first();
        if (!bot) return withCors(json({ error: 'not found' }, 404));
        if (!bm[2] && req.method === 'GET') return withCors(json({ bot: { ...bot, steps: JSON.parse(bot.steps || '[]'), is_live: !!bot.is_live } }));
        if (!bm[2] && req.method === 'PATCH') {
          await env.DB.prepare(`UPDATE bots SET name=COALESCE(?,name), trigger_type=COALESCE(?,trigger_type), keywords=?, event=?, steps=COALESCE(?,steps), window_closed_template=?, is_live=COALESCE(?,is_live), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
            .bind(body.name ?? null, body.trigger_type ?? null, body.keywords ?? null, body.event ?? null,
              body.steps ? JSON.stringify(body.steps) : null, body.window_closed_template ?? null,
              body.is_live === undefined ? null : (body.is_live ? 1 : 0), bot.id).run();
          return withCors(json({ ok: true }));
        }
        if (!bm[2] && req.method === 'DELETE') {
          await env.DB.prepare(`DELETE FROM bots WHERE id=?`).bind(bot.id).run();
          return withCors(json({ ok: true }));
        }
        if (bm[2] && req.method === 'POST') {
          const target = body.client_id || bot.client_id;
          const r = await env.DB.prepare(`INSERT INTO bots (client_id, name, trigger_type, keywords, event, steps, window_closed_template, is_live) VALUES (?,?,?,?,?,?,?,0)`)
            .bind(target, bot.name + ' (עותק)', bot.trigger_type, bot.keywords, bot.event, bot.steps, bot.window_closed_template).run();
          return withCors(json({ bot: { id: r.meta.last_row_id } }));
        }
      }

      /* automations: single edit/delete */
      const am = path.match(/^\/api\/automations\/(\d+)$/);
      if (am) {
        const auto = await env.DB.prepare(`SELECT * FROM automations WHERE id=?`).bind(am[1]).first();
        if (!auto) return withCors(json({ error: 'not found' }, 404));
        if (req.method === 'GET') return withCors(json({ automation: { ...auto, config: JSON.parse(auto.config || '{}'), is_active: !!auto.is_active } }));
        if (req.method === 'PATCH') {
          await env.DB.prepare(`UPDATE automations SET name=COALESCE(?,name), trigger_event=COALESCE(?,trigger_event), action=COALESCE(?,action), config=COALESCE(?,config), handoff_bot_id=?, is_active=COALESCE(?,is_active), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
            .bind(body.name ?? null, body.trigger_event ?? null, body.action ?? null,
              body.config ? JSON.stringify(body.config) : null,
              body.handoff_bot_id === undefined ? auto.handoff_bot_id : body.handoff_bot_id,
              body.is_active === undefined ? null : (body.is_active ? 1 : 0), auto.id).run();
          return withCors(json({ ok: true }));
        }
        if (req.method === 'DELETE') {
          await env.DB.prepare(`DELETE FROM automations WHERE id=?`).bind(auto.id).run();
          return withCors(json({ ok: true }));
        }
      }

      /* conversations: messages, send, pause */
      const msgMatch = path.match(/^\/api\/conversations\/(\d+)\/messages$/);
      if (msgMatch && req.method === 'GET') {
        const s = await env.DB.prepare(`SELECT * FROM bot_sessions WHERE id=?`).bind(msgMatch[1]).first();
        if (!s) return withCors(json({ error: 'not found' }, 404));
        const rows = (await env.DB.prepare(`SELECT * FROM messages WHERE client_id=? AND contact_phone=? ORDER BY id ASC LIMIT 300`).bind(s.client_id, s.contact_phone).all()).results;
        return withCors(json({ messages: rows }));
      }
      if (path === '/api/conversations/send' && req.method === 'POST') {
        const client = await getClient(env, body.client_id);
        if (!client) return withCors(json({ error: 'unknown client' }, 404));
        let res;
        if (body.template_name) {
          res = await eb.sendTemplate(client, { phone: body.phone, templateName: body.template_name, params: body.params || [], customerName: body.customer_name });
        } else {
          const { isOpen } = await eb.conversationWindow(client, body.phone);
          if (!isOpen) return withCors(json({ error: 'window_closed', message: 'חלון ה-24 שעות סגור — אפשר לשלוח תבנית בלבד' }, 409));
          res = await eb.sendMessage(client, { to: { phoneNumber: body.phone }, type: 'text', text: body.text });
        }
        await env.DB.prepare(`INSERT INTO messages (client_id, contact_phone, direction, sent_by, content_type, message_text, template_name, delivery_status) VALUES (?,?,?,?,?,?,?,'sent')`)
          .bind(client.id, body.phone, 'outbound', 'team', body.template_name ? 'template' : 'text', body.text || null, body.template_name || null).run();
        return withCors(json({ ok: true, res }));
      }
      if (path === '/api/conversations/pause' && req.method === 'POST') {
        await env.DB.prepare(`UPDATE bot_sessions SET paused=?, status=CASE WHEN ?=1 THEN 'handoff' ELSE 'active' END, last_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
          .bind(body.paused ? 1 : 0, body.paused ? 1 : 0, body.conversation_id).run();
        return withCors(json({ ok: true }));
      }

      /* activity log */
      if (path === '/api/activity' && req.method === 'GET') {
        const p = ['SELECT e.*, c.name AS client_name, b.name AS bot_name FROM webhook_events e LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN bots b ON b.id=e.bot_id WHERE 1=1'];
        const binds = [];
        if (url.searchParams.get('client_id')) { p.push('AND e.client_id=?'); binds.push(+url.searchParams.get('client_id')); }
        if (url.searchParams.get('event_type')) { p.push('AND e.event_type=?'); binds.push(url.searchParams.get('event_type')); }
        if (url.searchParams.get('result')) { p.push('AND e.result=?'); binds.push(url.searchParams.get('result')); }
        p.push('ORDER BY e.id DESC LIMIT 200');
        const rows = (await env.DB.prepare(p.join(' ')).bind(...binds).all()).results;
        return withCors(json({ events: rows.map(e => ({ ...e, payload: JSON.parse(e.payload || 'null') })) }));
      }

      return withCors(json({ error: 'not found' }, 404));
    } catch (err) {
      return withCors(json({ error: String(err.message || err) }, 500));
    }
  },
};
