/* Bot engine: matches webhook events to bots and runs their steps.
   Step types: text, buttons, link, file, template, question, condition,
   easybizy_action, handoff. Buttons/question pause the session until the
   customer's next message arrives as a webhook. */
import * as eb from './easybizy.js';

const WA_EVENTS = ['whatsapp-messages.received', 'whatsapp-messages.delivered', 'whatsapp-messages.failed'];

function interpolate(text, ctx) {
  if (!text) return text;
  return String(text).replace(/\{([^}]+)\}/g, (_, path) => {
    const parts = path.trim().split('.');
    let v;
    if (parts[0] === 'answers') v = ctx.answers;
    else if (parts[0] === 'customerName') return ctx.customerName || '';
    else v = ctx.trigger;
    for (const p of parts[0] === 'answers' ? parts.slice(1) : parts) v = v?.[p];
    return v ?? '';
  });
}

/* Privacy: no message content is ever stored. Flow state lives only in
   bot_sessions (current step + collected answers), expired after 48h idle. */

/* Send one free-form message honoring the 24h window; falls back to the bot's
   window-closed template when the window is shut. Returns what was sent. */
async function sendSmart(client, bot, phone, ctx, payload) {
  const { isOpen } = await eb.conversationWindow(client, phone).catch(() => ({ isOpen: true }));
  if (!isOpen && bot.window_closed_template) {
    const res = await eb.sendTemplate(client, {
      phone, templateName: bot.window_closed_template,
      params: [ctx.customerName || ''], customerName: ctx.customerName,
    });
    return { via: 'template', res };
  }
  const res = await eb.sendMessage(client, { to: { phoneNumber: phone }, ...payload });
  return { via: 'message', res };
}

/* Run steps from `startIdx` inside `steps`. Stops (returns waiting state) on
   buttons/question; returns 'done' when the list is exhausted. */
async function runSteps(env, client, bot, session, steps, startIdx, ctx) {
  const db = env.DB;
  for (let i = startIdx; i < steps.length; i++) {
    const s = steps[i];
    ctx.stepLabel = `שלב ${i + 1}`;
    try {
      if (s.type === 'text') {
        const text = interpolate(s.text, ctx);
        await sendSmart(client, bot, session.contact_phone, ctx, { type: 'text', text });
      } else if (s.type === 'buttons') {
        const text = interpolate(s.text, ctx);
        const buttons = (s.options || []).slice(0, 10).map(o => ({ type: 'QUICK_REPLY', label: o.label, value: o.value }));
        const payload = { type: 'text', text, buttons };
        if (buttons.length > 3) payload.buttonsTitle = s.buttonsTitle || 'בחרו';
        await sendSmart(client, bot, session.contact_phone, ctx, payload);
        return { waiting: true, at: i };               // wait for the tap
      } else if (s.type === 'link') {
        const text = interpolate(s.text, ctx);
        await sendSmart(client, bot, session.contact_phone, ctx, {
          type: 'text', text, buttons: [{ type: 'URL', label: s.buttonLabel || 'פתיחה', url: s.url }],
        });
      } else if (s.type === 'file') {
        await sendSmart(client, bot, session.contact_phone, ctx, { type: 'document', mediaId: s.mediaId, text: interpolate(s.caption || '', ctx) });
      } else if (s.type === 'template') {
        const params = (s.params || []).map(p => interpolate(p, ctx));
        await eb.sendTemplate(client, { phone: session.contact_phone, templateName: s.templateName, language: s.language || 'he', params, customerName: ctx.customerName });
      } else if (s.type === 'question') {
        const text = interpolate(s.text, ctx);
        await sendSmart(client, bot, session.contact_phone, ctx, { type: 'text', text });
        return { waiting: true, at: i, question: s.saveAs || 'answer' };
      } else if (s.type === 'condition') {
        const val = String(ctx.answers[s.field] ?? ctx.trigger?.[s.field] ?? '');
        const pass = s.op === 'eq' ? val === s.value : s.op === 'exists' ? !!val : val.includes(s.value || '');
        const branch = pass ? (s.then || []) : (s.else || []);
        if (branch.length) {
          const r = await runSteps(env, client, bot, session, branch, 0, ctx);
          if (r.waiting) return r;
        }
      } else if (s.type === 'easybizy_action') {
        const note = interpolate(s.note || '', ctx);
        if (s.action === 'create_lead') {
          await eb.createLead(client, { name: ctx.customerName || session.contact_phone, mobile: session.contact_phone, note });
        } else if (s.action === 'create_customer') {
          await eb.createCustomer(client, { firstName: ctx.customerName || '', mobile: session.contact_phone, note });
        } else if (s.action === 'add_activity' && session.easybizy_customer_id) {
          await eb.addCustomerActivity(client, session.easybizy_customer_id, note);
        }
      } else if (s.type === 'handoff') {
        await db.prepare(`UPDATE bot_sessions SET status='handoff', paused=1, last_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(session.id).run();
        return { done: true, handoff: true };
      }
    } catch (err) {
      throw err;
    }
  }
  return { done: true };
}

function botSteps(bot) { try { return JSON.parse(bot.steps || '[]'); } catch { return []; } }

/* Pick the live bot that should handle an inbound message.
   Priority: keyword match > first-message > any-message. */
async function matchMessageBot(db, clientId, text, isFirstEver) {
  const bots = (await db.prepare(`SELECT * FROM bots WHERE client_id=? AND is_live=1 AND trigger_type IN ('keywords','first_message','any_message')`).bind(clientId).all()).results;
  const lower = (text || '').toLowerCase();
  const kw = bots.find(b => b.trigger_type === 'keywords' && (b.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean).some(k => lower.includes(k)));
  if (kw) return kw;
  if (isFirstEver) { const fm = bots.find(b => b.trigger_type === 'first_message'); if (fm) return fm; }
  return bots.find(b => b.trigger_type === 'any_message') || null;
}

async function startSession(env, client, bot, phone, customerName, triggerData) {
  const db = env.DB;
  await db.prepare(`UPDATE bot_sessions SET status='done' WHERE client_id=? AND contact_phone=? AND status IN ('active','waiting')`).bind(client.id, phone).run();
  const r = await db.prepare(`INSERT INTO bot_sessions (client_id, bot_id, contact_phone, customer_name, status, trigger_data) VALUES (?,?,?,?,'active',?)`)
    .bind(client.id, bot.id, phone, customerName ?? null, JSON.stringify(triggerData || {})).run();
  return { id: r.meta.last_row_id, client_id: client.id, bot_id: bot.id, contact_phone: phone, customer_name: customerName, status: 'active', current_step: 0, saved_answers: {}, trigger_data: triggerData || {} };
}

async function continueSession(env, client, session, bot, incoming) {
  const db = env.DB;
  const steps = botSteps(bot);
  const answers = JSON.parse(session.saved_answers || '{}');
  const ctx = { answers, trigger: JSON.parse(session.trigger_data || '{}'), customerName: session.customer_name };

  let startIdx = session.current_step;
  if (session.status === 'waiting') {
    const waitingStep = steps[startIdx];
    if (waitingStep?.type === 'question') {
      answers[waitingStep.saveAs || 'answer'] = incoming.text || incoming.selection?.title || '';
      startIdx += 1;
    } else if (waitingStep?.type === 'buttons') {
      const value = incoming.selection?.value ?? (incoming.text || '').trim();
      const opt = (waitingStep.options || []).find(o => o.value === value || o.label === value);
      const branch = opt ? (waitingStep.branches || {})[opt.value] : null;
      if (branch) {
        const r = await runSteps(env, client, bot, session, branch, 0, ctx);
        if (r.waiting) return persistWaiting(db, session, startIdx, answers);
        startIdx += 1;
      } else {
        // Unrecognized answer: re-ask the same buttons once.
        const r = await runSteps(env, client, bot, session, steps, startIdx, ctx);
        if (r.waiting) return persistWaiting(db, session, startIdx, answers);
        startIdx += 1;
      }
    }
  }
  const r = await runSteps(env, client, bot, session, steps, startIdx, ctx);
  if (r.waiting) return persistWaiting(db, session, startIdx, answers);
  await db.prepare(`UPDATE bot_sessions SET status='done', saved_answers=?, last_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .bind(JSON.stringify(answers), session.id).run();
  return { done: true };
}

async function persistWaiting(db, session, stepIdx, answers) {
  await db.prepare(`UPDATE bot_sessions SET status='waiting', current_step=?, saved_answers=?, last_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .bind(stepIdx, JSON.stringify(answers), session.id).run();
  return { waiting: true };
}

function extractContact(data) {
  return {
    phone: data?.customer?.phone || data?.customer?.mobile || data?.from || data?.phone || data?.phoneNumber || null,
    name: data?.customer?.name || data?.contact?.name || null,
  };
}

/* Main webhook entry. Returns { result, details } for the activity log. */
export async function handleEvent(env, client, envelope) {
  const db = env.DB;
  const eventType = `${envelope.resource}.${envelope.action}`;
  const data = envelope.data || {};

  // delivery status updates: logged as activity only, nothing to update
  if (eventType === 'whatsapp-messages.delivered' || eventType === 'whatsapp-messages.failed') {
    return { result: eventType.endsWith('failed') ? 'failed' : 'ignored', details: data.error || 'נמסר' };
  }

  if (eventType === 'whatsapp-messages.received') {
    const { phone, name } = extractContact(data);
    if (!phone) return { result: 'ignored', details: 'לא זוהה מספר שולח' };
    const incoming = { text: data.text || '', selection: data.selection || null };

    // active session continues (also sessions opened by an automation handoff)
    const session = await db.prepare(`SELECT * FROM bot_sessions WHERE client_id=? AND contact_phone=? AND status IN ('active','waiting','automation_handoff') AND paused=0 ORDER BY id DESC LIMIT 1`)
      .bind(client.id, phone).first();
    if (session) {
      const bot = await db.prepare(`SELECT * FROM bots WHERE id=? AND is_live=1`).bind(session.bot_id).first();
      if (bot) {
        if (session.status === 'automation_handoff') {
          // The customer replied to an automation message: the linked bot starts from step 1.
          await db.prepare(`UPDATE bot_sessions SET status='active', trigger_data=? WHERE id=?`)
            .bind(JSON.stringify({ ...(JSON.parse(session.trigger_data || '{}')), reply: incoming.text || incoming.selection?.title || '' }), session.id).run();
          const ctx = { answers: {}, trigger: JSON.parse(session.trigger_data || '{}'), customerName: session.customer_name };
          const r = await runSteps(env, client, bot, session, botSteps(bot), 0, ctx);
          if (r.waiting) await persistWaiting(db, session, r.at, {});
          else await db.prepare(`UPDATE bot_sessions SET status='done' WHERE id=?`).bind(session.id).run();
          return { result: 'bot_ran', details: `${bot.name} · תגובה לאוטומציה` };
        }
        await continueSession(env, client, session, bot, incoming);
        return { result: 'bot_ran', details: `${bot.name} · המשך סשן` };
      }
    }

    // no active session: match a new bot
    const prior = await db.prepare(`SELECT id FROM bot_sessions WHERE client_id=? AND contact_phone=? LIMIT 1`).bind(client.id, phone).first();
    const bot = await matchMessageBot(db, client.id, incoming.text, !prior);
    if (!bot) return { result: 'no_bot', details: 'אין בוט פעיל מתאים' };
    const s = await startSession(env, client, bot, phone, name, data);
    const ctx = { answers: {}, trigger: data, customerName: name };
    const r = await runSteps(env, client, bot, s, botSteps(bot), 0, ctx);
    if (r.waiting) await persistWaiting(db, s, r.at, {});
    else await db.prepare(`UPDATE bot_sessions SET status='done' WHERE id=?`).bind(s.id).run();
    return { result: 'bot_ran', details: `${bot.name} · ${ctx.stepLabel || 'שלב 1'}` };
  }

  // business events (leads.create, appointments.create, ...)
  const bots = (await db.prepare(`SELECT * FROM bots WHERE client_id=? AND is_live=1 AND trigger_type='event' AND event=?`).bind(client.id, eventType).all()).results;
  if (!bots.length) return { result: 'no_bot', details: 'אין בוט פעיל לאירוע' };
  const phone = extractContact(data).phone || data.mobile || data.phone;
  const name = extractContact(data).name || data.name || data.firstName;
  for (const bot of bots) {
    if (!phone) break;
    const s = await startSession(env, client, bot, phone, name, data);
    const r = await runSteps(env, client, bot, s, botSteps(bot), 0, { answers: {}, trigger: data, customerName: name });
    if (r.waiting) await persistWaiting(db, s, r.at, {});
    else await db.prepare(`UPDATE bot_sessions SET status='done' WHERE id=?`).bind(s.id).run();
  }
  return { result: 'bot_ran', details: bots.map(b => b.name).join(', ') };
}

/* Automations: one API action per webhook event, no conversation.
   Optionally hands the customer to a live bot when they reply
   (status 'automation_handoff' in bot_sessions, picked up by handleEvent). */
export async function runAutomations(env, client, envelope) {
  const db = env.DB;
  const eventType = `${envelope.resource}.${envelope.action}`;
  const data = envelope.data || {};
  const autos = (await db.prepare(`SELECT * FROM automations WHERE client_id=? AND trigger_event=? AND is_active=1`)
    .bind(client.id, eventType).all()).results;
  if (!autos.length) return null;

  const { phone, name } = extractContact(data);
  const ctx = {
    ...data, event: eventType, trigger: data, answers: {},
    name: name || data.name || data.firstName || '',
    phone: phone || data.mobile || data.phone || data.phoneNumber || '',
    customerName: name || data.name || data.firstName || '',
  };
  const cid = data.customerId || data.customer_id || data.id;
  const results = [];

  for (const a of autos) {
    const cfg = JSON.parse(a.config || '{}');
    try {
      let detail = '';
      if (a.action === 'send_template') {
        if (!ctx.phone) throw new Error('אין מספר טלפון באירוע');
        await eb.sendTemplate(client, { phone: ctx.phone, templateName: cfg.template_name, params: ctx.name ? [ctx.name] : [], customerName: ctx.name });
        detail = `נשלחה תבנית ${cfg.template_name}`;
      } else if (a.action === 'send_text') {
        if (!ctx.phone) throw new Error('אין מספר טלפון באירוע');
        const win = await eb.conversationWindow(client, ctx.phone);
        if (!win.isOpen) throw new Error('חלון 24 השעות סגור — נדרשת תבנית');
        await eb.sendMessage(client, { to: { phoneNumber: ctx.phone }, type: 'text', text: interpolate(cfg.text || '', ctx) });
        detail = 'נשלחה הודעת טקסט';
      } else if (a.action === 'create_lead') {
        await eb.createLead(client, { name: ctx.name || ctx.phone, mobile: ctx.phone, note: interpolate(cfg.note || '', ctx) });
        detail = 'נוצר ליד';
      } else if (a.action === 'add_lead_activity') {
        const leadId = data.leadId || data.id;
        if (!leadId) throw new Error('לא זוהה מזהה ליד באירוע');
        await eb.addLeadActivity(client, leadId, interpolate(cfg.note || '', ctx));
        detail = 'נרשמה פעילות בכרטיס ליד';
      } else if (a.action === 'create_customer') {
        await eb.createCustomer(client, { firstName: ctx.name || '', mobile: ctx.phone, note: interpolate(cfg.note || '', ctx) });
        detail = 'נוצר לקוח';
      } else if (a.action === 'add_customer_activity') {
        if (!cid) throw new Error('לא זוהה מזהה לקוח באירוע');
        await eb.addCustomerActivity(client, cid, interpolate(cfg.note || '', ctx));
        detail = 'נרשמה פעילות בכרטיס לקוח';
      } else if (a.action === 'create_invoice') {
        if (!cid) throw new Error('לא זוהה מזהה לקוח באירוע');
        await eb.createInvoice(client, { customerId: cid, amount: +cfg.amount, description: interpolate(cfg.description || '', ctx) });
        detail = `הופקה חשבונית על ₪${cfg.amount}`;
      } else if (a.action === 'payment_link') {
        await eb.createPaymentSession(client, { customerId: cid || undefined, amount: +cfg.amount, description: interpolate(cfg.description || '', ctx) });
        detail = `נוצר קישור תשלום על ₪${cfg.amount}`;
      } else if (a.action === 'gift_card') {
        await eb.createGiftCard(client, { customerId: cid || undefined, amount: +cfg.amount });
        detail = `נוצר קישור שובר מתנה על ₪${cfg.amount}`;
      }

      if (a.handoff_bot_id && ctx.phone) {
        const bot = await db.prepare(`SELECT * FROM bots WHERE id=? AND is_live=1`).bind(a.handoff_bot_id).first();
        if (bot) {
          await db.prepare(`UPDATE bot_sessions SET status='done' WHERE client_id=? AND contact_phone=? AND status IN ('active','waiting','automation_handoff')`)
            .bind(client.id, ctx.phone).run();
          await db.prepare(`INSERT INTO bot_sessions (client_id, bot_id, contact_phone, customer_name, status, current_step, trigger_data) VALUES (?,?,?,?,'automation_handoff',0,?)`)
            .bind(client.id, bot.id, ctx.phone, ctx.name || null, JSON.stringify({ automation_id: a.id, event: eventType })).run();
          detail += ` · תגובה תחובר לבוט "${bot.name}"`;
        }
      }
      results.push(`${a.name}: ${detail || a.action}`);
    } catch (err) {
      results.push(`${a.name}: נכשל — ${String(err.message || err)}`);
    }
  }
  return results.join(' | ');
}
