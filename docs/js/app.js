/* WA Manager — router and views. */
(() => {
  const { esc, fmtTime, fmtAgo, fmtDateTime, statusBadge, qualityBadge, resultBadge, toast, modal, confirmModal, EVENT_LABELS, ALL_EVENTS, TRIGGER_LABELS, STEP_TYPES, AUTOMATION_ACTIONS } = UI;
  const root = document.getElementById('app');
  let state = { clients: [], currentClient: null, convoTimer: null };

  /* theme: saved choice wins, then ?theme= override, then system preference */
  const Theme = {
    init() {
      const urlTheme = new URLSearchParams(location.search).get('theme');
      const t = urlTheme || localStorage.getItem('wa-theme') ||
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = t;
      if (urlTheme) localStorage.setItem('wa-theme', urlTheme);
    },
    toggle() {
      const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = n;
      localStorage.setItem('wa-theme', n);
    },
  };
  Theme.init();

  /* ---------------- shell ---------------- */
  const CLIENT_SECTIONS = [['setup', 'הגדרה', '▤'], ['bots', 'בוטים', '✦'], ['automations', 'אוטומציות', '⚡'], ['convos', 'שיחות', '✉'], ['activity', 'פעילות', '≡']];

  /* active: 'clients' for the global list. clientNav: { client, section } renders
     the sidebar as that client's menu instead. */
  function shell(active, inner, clientNav) {
    const who = `
          <div class="who">
            ${Api.demoMode ? '<span class="demo-pill">מצב הדגמה</span> Tech Mate · עידן' : `<span class="num" style="font-size:12px">${esc(sessionStorage.getItem('wa_email') || '')}</span>`}
            <div style="margin-top:6px"><a href="#" id="logout">התנתקות</a></div>
          </div>`;
    const nav = clientNav ? `
          <a class="back-link" href="#/clients" style="padding:4px 12px">→ כל הלקוחות</a>
          <div class="client-nav-head">
            <div class="cn-name">${esc(clientNav.client.name)}</div>
            ${statusBadge(clientNav.client.connection_status)}
          </div>
          ${CLIENT_SECTIONS.map(([k, l, ico]) => `<a class="nav-item ${clientNav.section === k ? 'active' : ''}" href="#/client/${clientNav.client.id}/${k}"><span class="ico">${ico}</span> ${l}</a>`).join('')}`
        : `
          <a class="nav-item ${active === 'clients' ? 'active' : ''}" href="#/clients"><span class="ico">▦</span> לקוחות</a>`;
    root.innerHTML = `
      <div class="layout">
        <div class="topbar">
          <button class="icon-btn" id="nav-burger" title="תפריט">☰</button>
          <span class="brand" style="padding:0"><span class="logo">W</span> WA Manager</span>
        </div>
        <div class="nav-overlay" id="nav-overlay"></div>
        <aside class="sidebar">
          <div class="brand"><span class="logo">W</span> WA Manager<button class="icon-btn" id="theme-toggle" title="מצב כהה / בהיר" style="margin-inline-start:auto">◐</button></div>
          ${nav}
          <div class="spacer"></div>
          ${who}
        </aside>
        <main class="main">${inner}</main>
      </div>`;
    document.getElementById('logout').onclick = (e) => { e.preventDefault(); Api.logout(); };
    document.getElementById('theme-toggle').onclick = () => Theme.toggle();
    const closeNav = () => document.body.classList.remove('nav-open');
    document.getElementById('nav-burger').onclick = () => document.body.classList.toggle('nav-open');
    document.getElementById('nav-overlay').onclick = closeNav;
    root.querySelectorAll('.sidebar .nav-item, .sidebar .back-link').forEach(a => a.addEventListener('click', closeNav));
  }

  /* ---------------- login ---------------- */
  function viewLogin() {
    clearInterval(state.convoTimer);
    if (!Api.demoMode) return viewGoogleLogin();
    root.innerHTML = `
      <div class="login-wrap"><div class="login-card">
        <div class="logo">W</div>
        <h1>WA Manager</h1>
        <p>ניהול וואטסאפ לכל לקוחות EasyBizy במקום אחד · <b>מצב הדגמה</b> — נתוני דוגמה, כניסה חופשית</p>
        <button class="btn" style="width:100%;justify-content:center" id="demo-in">כניסה להדגמה</button>
      </div></div>`;
    document.getElementById('demo-in').onclick = async () => {
      await Api.login('demo'); location.hash = '#/clients';
    };
  }

  /* Real mode: sign in with Google only. The Worker verifies the ID token
     server-side and allows only allowlisted emails. */
  function viewGoogleLogin() {
    root.innerHTML = `
      <div class="login-wrap"><div class="login-card">
        <div class="logo">W</div>
        <h1>WA Manager</h1>
        <p>ניהול וואטסאפ לכל לקוחות EasyBizy במקום אחד</p>
        <div id="g-btn" style="display:flex;justify-content:center;margin-top:18px;min-height:44px"></div>
        <p class="hint" style="text-align:center;margin-top:14px">הכניסה מוגבלת לחשבון Google מורשה בלבד</p>
      </div></div>`;
    if (!CONFIG.GOOGLE_CLIENT_ID) {
      document.getElementById('g-btn').innerHTML = '<span class="hint">חסר GOOGLE_CLIENT_ID בקובץ config.js</span>';
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          try {
            await Api.loginGoogle(resp.credential);
            location.hash = '#/clients';
          } catch {
            toast('הכניסה נדחתה — החשבון אינו מורשה');
          }
        },
      });
      google.accounts.id.renderButton(document.getElementById('g-btn'), { theme: 'outline', size: 'large', width: 260, locale: 'he' });
    };
    s.onerror = () => {
      document.getElementById('g-btn').innerHTML = '<span class="hint">לא ניתן לטעון את כפתור Google — בדקו חיבור לרשת</span>';
    };
    document.head.appendChild(s);
  }

  /* ---------------- clients list ---------------- */
  async function viewClients(openAdd) {
    clearInterval(state.convoTimer);
    const { clients } = await Api.listClients();
    state.clients = clients;
    shell('clients', `
      <div class="page-head">
        <h1>לקוחות</h1>
        <span class="badge">${clients.length} עסקי EasyBizy</span>
        <div class="grow"></div>
        <div class="search-input"><input class="input" id="q" placeholder="חיפוש לפי שם או מספר"></div>
        <button class="btn" id="add">＋ הוספת לקוח</button>
      </div>
      <p class="page-sub">כל עסק שאתם מנהלים, עם מצב החיבור וסטטוס השליחה בוואטסאפ. <a href="#/activity" style="color:var(--green-dark)">פעילות כללית בין כל הלקוחות ←</a></p>
      <div class="tbl-wrap"><table class="tbl" id="ct"><thead><tr>
        <th data-k="name">עסק</th><th data-k="whatsapp_number">מספר וואטסאפ</th><th data-k="quality_rating">איכות</th>
        <th data-k="active_bots">בוטים פעילים</th><th data-k="last_event_at">אירוע אחרון</th>
      </tr></thead><tbody></tbody></table></div>`);

    let sortK = 'name', sortDir = 1;
    const render = () => {
      const q = document.getElementById('q').value.trim();
      const rows = clients
        .filter(c => !q || (c.name || '').includes(q) || (c.whatsapp_number || '').includes(q))
        .sort((a, b) => sortDir * String(a[sortK] ?? '').localeCompare(String(b[sortK] ?? ''), 'he'));
      document.querySelector('#ct tbody').innerHTML = rows.map(c => `
        <tr data-id="${c.id}">
          <td><div class="cell-main">${esc(c.name)}</div><div class="cell-sub">${statusBadge(c.connection_status)}</div></td>
          <td class="num">${esc(c.whatsapp_number || '—')}</td>
          <td>${qualityBadge(c.quality_rating)}</td>
          <td class="num">${c.active_bots ?? 0}</td>
          <td>${fmtAgo(c.last_event_at)}</td>
        </tr>`).join('') || `<tr><td colspan="5"><div class="empty"><div class="big">▦</div>אין לקוחות עדיין — מוסיפים את הראשון</div></td></tr>`;
      document.querySelectorAll('#ct tbody tr[data-id]').forEach(tr =>
        tr.onclick = () => location.hash = '#/client/' + tr.dataset.id);
    };
    render();
    document.getElementById('q').oninput = render;
    document.querySelectorAll('#ct th').forEach(th => th.onclick = () => {
      const k = th.dataset.k; sortDir = (sortK === k) ? -sortDir : 1; sortK = k; render();
    });
    document.getElementById('add').onclick = () => clientModal();
    if (openAdd) clientModal();
  }

  function clientModal(client) {
    const isNew = !client;
    const m = modal(`
      <h3>${isNew ? 'הוספת לקוח EasyBizy' : 'עריכת ' + esc(client.name)}</h3>
      <label class="field"><span>שם העסק</span><input class="input" id="cm-name" value="${esc(client?.name || '')}" placeholder="סטודיו ליאור ביוטי"></label>
      <label class="field"><span>EasyBizy API key</span>
        <input class="input" dir="ltr" id="cm-key" value="${esc(client?.api_key_masked || '')}" placeholder="eb_live_...">
        <span class="hint">מופק במסוף EasyBizy ע״י בעל החשבון (Management → API)</span></label>
      <label class="field"><span>EasyBizy API secret</span>
        <input class="input" dir="ltr" type="password" id="cm-secret" placeholder="${client?.api_secret_set ? 'שמור — השאירו ריק כדי לא לשנות' : 'סוד ה-API'}">
      </label>
      <label class="field"><span>הערות</span><input class="input" id="cm-notes" value="${esc(client?.notes || '')}"></label>
      <div class="modal-actions">
        <button class="btn" id="cm-save">${isNew ? 'הוספה' : 'שמירה'}</button>
        <button class="btn secondary" id="cm-cancel">ביטול</button>
      </div>`);
    m.querySelector('#cm-cancel').onclick = () => m.remove();
    m.querySelector('#cm-save').onclick = async () => {
      const body = {
        name: m.querySelector('#cm-name').value.trim(),
        notes: m.querySelector('#cm-notes').value.trim(),
      };
      const key = m.querySelector('#cm-key').value.trim();
      const secret = m.querySelector('#cm-secret').value;
      if (isNew) { body.api_key = key; body.api_secret = secret; }
      else { if (key && !key.includes('•')) body.api_key = key; if (secret) body.api_secret = secret; }
      if (!body.name) return toast('חסר שם עסק');
      if (isNew && (!body.api_key || !body.api_secret)) return toast('חסרים API key ו-secret');
      if (isNew) { const { client } = await Api.createClient(body); m.remove(); location.hash = '#/client/' + client.id; }
      else { await Api.updateClient(client.id, body); m.remove(); toast('נשמר'); route(); }
    };
  }

  /* ---------------- client detail ---------------- */
  async function viewClient(id, tab = 'setup') {
    clearInterval(state.convoTimer);
    const { client } = await Api.getClient(id);
    state.currentClient = client;
    if (!client) return viewClients();
    shell('clients', `
      <div class="page-head" style="margin-top:2px">
        <h1>${esc(client.name)}</h1>
        ${client.whatsapp_number ? `<span class="badge blue num">${esc(client.whatsapp_number)}</span>` : ''}
        ${client.quality_rating ? qualityBadge(client.quality_rating) : ''}
      </div>
      <div id="tab-body"></div>`, { client, section: tab });
    const body = document.getElementById('tab-body');
    if (tab === 'setup') renderSetup(body, client);
    if (tab === 'bots') renderBots(body, client);
    if (tab === 'automations') renderAutomations(body, client);
    if (tab === 'convos') renderConvos(body, client);
    if (tab === 'activity') renderActivity(body, client.id);
  }

  /* ---- automations tab ---- */
  async function renderAutomations(el, client) {
    const { automations } = await Api.listAutomations(client.id);
    const { bots } = await Api.listBots(client.id);
    const botName = (bid) => bots.find(b => b.id === +bid)?.name || '';
    el.innerHTML = `
      <div class="toolbar">
        <span class="page-sub" style="margin:0">${automations.length} אוטומציות · אירוע ← פעולה אחת, בלי שיחה</span>
        <div class="grow"></div>
        <button class="btn" id="new-auto">＋ אוטומציה חדשה</button>
      </div>
      <div class="guide" style="margin-bottom:14px">אוטומציה היא לא בוט: כשאירוע מגיע מ-EasyBizy מבוצעת פעולה אחת, וזהו. לתהליך עם שאלות ותשובות — מסך הבוטים.</div>
      <div class="bots-grid">
        ${automations.map(a => `
          <div class="bot-card" data-id="${a.id}">
            <div class="top"><h4>${esc(a.name)}</h4>${a.is_active ? '<span class="badge green"><span class="dot"></span>פעילה</span>' : '<span class="badge">כבויה</span>'}</div>
            <div class="trig">כש־${esc(EVENT_LABELS[a.trigger_event] || a.trigger_event)} ← ${esc(AUTOMATION_ACTIONS[a.action]?.label || a.action)}</div>
            ${a.handoff_bot_id ? `<div class="trig" style="color:var(--muted)">הלקוח משיב ← בוט: ${esc(botName(a.handoff_bot_id))}</div>` : ''}
            <div class="stats"><span class="num">${a.runs_week ?? 0} ריצות השבוע</span><span class="mono" style="font-size:11.5px">${esc(a.trigger_event)}</span></div>
            <div class="actions">
              <button class="btn secondary small" data-act="edit">עריכה</button>
              <button class="btn ${a.is_active ? 'secondary' : ''} small" data-act="toggle">${a.is_active ? 'כיבוי' : 'הפעלה'}</button>
              <button class="btn danger small" data-act="del">מחיקה</button>
            </div>
          </div>`).join('') || '<div class="empty" style="grid-column:1/-1"><div class="big">⚡</div>אין אוטומציות עדיין — יוצרים את הראשונה</div>'}
      </div>`;
    el.querySelector('#new-auto').onclick = () => location.hash = `#/client/${client.id}/automation`;
    el.querySelectorAll('.bot-card').forEach(card => {
      const id = +card.dataset.id;
      const auto = automations.find(a => a.id === id);
      card.onclick = (e) => { if (!e.target.dataset.act) location.hash = `#/client/${client.id}/automation/${id}`; };
      card.querySelector('[data-act=edit]').onclick = () => location.hash = `#/client/${client.id}/automation/${id}`;
      card.querySelector('[data-act=toggle]').onclick = async () => { await Api.toggleAutomation(id, !auto.is_active); toast(auto.is_active ? 'האוטומציה כובתה' : 'האוטומציה פעילה'); renderAutomations(el, client); };
      card.querySelector('[data-act=del]').onclick = () => confirmModal('מחיקת אוטומציה', `האוטומציה "${auto.name}" תימחק.`, 'מחיקה', async () => { await Api.deleteAutomation(id); renderAutomations(el, client); });
    });
  }

  /* ---- add / edit automation screen ---- */
  async function viewAutomation(clientId, automationId) {
    const { client } = await Api.getClient(clientId);
    if (!client) return viewClients();
    let auto = { name: '', trigger_event: 'leads.create', action: 'send_template', config: {}, is_active: false };
    if (automationId) {
      const res = await Api.getAutomation(automationId);
      if (res.automation) auto = { ...res.automation, config: res.automation.config || {} };
    }
    shell('clients', `
      <a class="back-link" href="#/client/${client.id}/automations">→ אוטומציות · ${esc(client.name)}</a>
      <div class="page-head" style="margin-top:10px"><h1>${automationId ? 'עריכת אוטומציה' : 'אוטומציה חדשה'}</h1></div>
      <div class="card" style="max-width:640px">
        <label class="field"><span>שם האוטומציה</span>
          <input class="input" id="au-name" value="${esc(auto.name)}" placeholder="ברכה לליד חדש">
        </label>

        <h3 style="margin-top:18px">1 · מתי זה קורה? (אירוע מהמערכת)</h3>
        <label class="field"><span>אירוע מ-EasyBizy</span>
          <select class="input" id="au-event">${ALL_EVENTS.map(ev => `<option value="${ev}" ${auto.trigger_event === ev ? 'selected' : ''}>${esc(EVENT_LABELS[ev])} · ${ev}</option>`).join('')}</select>
        </label>

        <h3 style="margin-top:18px">2 · מה קורה? (פעולה אחת)</h3>
        <label class="field"><span>פעולה</span>
          <select class="input" id="au-action">${Object.entries(AUTOMATION_ACTIONS).map(([k, a]) => `<option value="${k}" ${auto.action === k ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>
        </label>
        <div class="guide" id="au-guide"></div>
        <div id="au-fields"></div>

        <h3 style="margin-top:18px">3 · אם הלקוח משיב (אופציונלי)</h3>
        <label class="field"><span>חיבור לבוט שינהל את השיחה</span>
          <select class="input" id="au-handoff"></select>
          <span class="hint">הבוט הנבחר יפתח שיחה מלאה עם הלקוח ברגע שהוא משיב (למשל: משיב לתבנית ← הבוט שואל שאלות וקובע תור).</span>
        </label>

        <div style="display:flex;gap:10px;margin-top:20px">
          <button class="btn" id="au-save">${automationId ? 'שמירה' : 'יצירת אוטומציה'}</button>
          <a class="btn secondary" href="#/client/${client.id}/automations">ביטול</a>
        </div>
      </div>`, { client, section: 'automations' });

    const root = document.getElementById('app');
    const actionSel = root.querySelector('#au-action');
    const fieldsEl = root.querySelector('#au-fields');
    const guideEl = root.querySelector('#au-guide');
    let templates = [];
    const { bots } = await Api.listBots(client.id);
    const handoffSel = root.querySelector('#au-handoff');
    handoffSel.innerHTML = `<option value="">ללא — האוטומציה מסתיימת אחרי הפעולה</option>` +
      bots.map(b => `<option value="${b.id}" ${auto.handoff_bot_id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');

    async function renderActionFields() {
      const a = AUTOMATION_ACTIONS[actionSel.value];
      guideEl.textContent = a.guidance;
      if (actionSel.value === 'send_template' && !templates.length) {
        fieldsEl.innerHTML = '<div class="hint">טוען תבניות…</div>';
        try { templates = (await Api.getTemplates(client.id)).templates || []; } catch { templates = []; }
      }
      fieldsEl.innerHTML = a.fields.map(f => {
        const val = esc(auto.config[f.k] || '');
        if (actionSel.value === 'send_template' && f.k === 'template_name') {
          if (!templates.length) return `<label class="field"><span>${esc(f.label)}</span><input class="input" data-k="${f.k}" dir="ltr" value="${val}" placeholder="${esc(f.placeholder || '')}"><span class="hint">לא נמצאו תבניות — יש ליצור תבנית במערכת EasyBizy קודם</span></label>`;
          const cur = auto.config.template_name || templates[0].name;
          return `<label class="field"><span>${esc(f.label)} (מתוך התבניות המאושרות ב-EasyBizy)</span>
            <select class="input" data-k="${f.k}" dir="ltr">${templates.map(t => `<option value="${esc(t.name)}" ${cur === t.name ? 'selected' : ''}>${esc(t.name)} · ${esc(t.language || 'he')}</option>`).join('')}</select>
            <span class="hint" id="tpl-example"></span></label>`;
        }
        if (f.textarea) return `<label class="field"><span>${esc(f.label)}</span><textarea class="input" data-k="${f.k}" rows="3" placeholder="${esc(f.placeholder || '')}">${val}</textarea></label>`;
        return `<label class="field"><span>${esc(f.label)}</span><input class="input" data-k="${f.k}" ${f.ltr ? 'dir="ltr"' : ''} value="${val}" placeholder="${esc(f.placeholder || '')}"></label>`;
      }).join('');
      const tplSel = fieldsEl.querySelector('select[data-k=template_name]');
      if (tplSel) {
        const showEx = () => {
          const t = templates.find(x => x.name === tplSel.value);
          fieldsEl.querySelector('#tpl-example').textContent = t?.example ? 'תצוגה: ' + t.example : '';
        };
        tplSel.onchange = showEx; showEx();
      }
    }
    actionSel.onchange = () => { collectFields(); renderActionFields(); };
    const collectFields = () => {
      fieldsEl.querySelectorAll('[data-k]').forEach(inp => { auto.config[inp.dataset.k] = inp.value; });
    };
    await renderActionFields();

    root.querySelector('#au-save').onclick = async () => {
      collectFields();
      const name = root.querySelector('#au-name').value.trim();
      if (!name) return toast('חסר שם לאוטומציה');
      const a = AUTOMATION_ACTIONS[actionSel.value];
      for (const f of a.fields) if (f.required && !(auto.config[f.k] || '').trim()) return toast('חסר שדה: ' + f.label);
      await Api.saveAutomation(client.id, { id: automationId ? +automationId : undefined, name, trigger_event: root.querySelector('#au-event').value, action: actionSel.value, config: auto.config, handoff_bot_id: handoffSel.value ? +handoffSel.value : null, is_active: auto.is_active });
      toast(automationId ? 'נשמר' : 'האוטומציה נוצרה (כבויה — מפעילים ממסך האוטומציות)');
      location.hash = `#/client/${client.id}/automations`;
    };
  }

  /* ---- setup tab ---- */
  async function renderSetup(el, client) {
    el.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h3>גישת EasyBizy API</h3>
          <div class="kv"><span class="k">API key</span><span class="v mono">${esc(client.api_key_masked || '—')}</span></div>
          <div class="kv"><span class="k">API secret</span><span class="v mono">${client.api_secret_set ? '••••••••••••' : '—'}</span></div>
          <div class="kv"><span class="k">בדיקה אחרונה</span><span class="v">${fmtAgo(client.last_checked_at)}</span></div>
          <div id="test-result"></div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button class="btn secondary" id="edit">עריכת פרטים</button>
            <button class="btn" id="test">בדיקת חיבור</button>
          </div>
        </div>
        <div class="card">
          <h3>Webhook ל-EasyBizy</h3>
          <label class="field"><span>Payload URL</span>
            <input class="input" dir="ltr" id="wh-url" value="" placeholder="— יושלם אחרי פריסת ה-Worker —" disabled>
            <span class="hint">כתובת ייחודית ללקוח. תופיע כאן אחרי שה-backend יעלה לאוויר.</span>
          </label>
          <label class="field"><span>סוד webhook (כותרת X-Webhook-Secret)</span>
            <input class="input" dir="ltr" type="password" id="wh-secret" placeholder="${client.webhook_secret_set ? 'שמור — הקלידו חדש להחלפה' : 'אופציונלי, מומלץ'}">
            <span class="hint">EasyBizy אינה חותמת על משלוחים; הכותרת היא הדרך לוודא שרק היא קוראת לנו.</span>
          </label>
          <button class="btn secondary small" id="wh-save">שמירת סוד</button>
        </div>
      </div>
      <div class="card">
        <h3>רשימת אירועים</h3>
        <p class="page-sub" style="margin-bottom:14px">להפעיל את כל 10 האירועים במסוף EasyBizy ← Webhooks. סימון ✓ = האירוע הגיע אלינו לפחות פעם אחת.</p>
        <div class="checklist">
          ${ALL_EVENTS.map(ev => `<div class="ck ${client.events_seen?.includes(ev) ? 'seen' : ''}"><span class="box">${client.events_seen?.includes(ev) ? '✓' : ''}</span>${esc(EVENT_LABELS[ev])} <span class="mono" style="color:var(--muted);font-size:11.5px">${esc(ev)}</span></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <h3>איזור מסוכן</h3>
        <button class="btn danger" id="del">מחיקת הלקוח וכל הנתונים שלו</button>
      </div>`;

    el.querySelector('#edit').onclick = () => clientModal(client);
    el.querySelector('#test').onclick = async () => {
      const btn = el.querySelector('#test'); btn.disabled = true; btn.textContent = 'בודק…';
      const res = await Api.testClient(client.id);
      btn.disabled = false; btn.textContent = 'בדיקת חיבור';
      el.querySelector('#test-result').innerHTML = res.ok
        ? `<div style="margin-top:12px">${statusBadge('connected')} <b class="num">${esc(res.whatsapp_number || '')}</b> · ${qualityBadge(res.quality_rating)} · יתרה יומית: <span class="num">${res.balance?.used_24h ?? 0}/${res.balance?.limit_24h ?? '—'}</span></div>`
        : `<div style="margin-top:12px">${statusBadge('key_rejected')} <span style="color:var(--red)">${esc(res.error || 'החיבור נכשל')}</span></div>`;
    };
    el.querySelector('#wh-save').onclick = async () => {
      const v = el.querySelector('#wh-secret').value;
      if (!v) return toast('לא הוקלד סוד חדש');
      await Api.updateClient(client.id, { webhook_secret: v });
      el.querySelector('#wh-secret').value = '';
      toast('סוד ה-webhook נשמר');
    };
    el.querySelector('#del').onclick = () => confirmModal('מחיקת לקוח', `כל הבוטים, השיחות והלוגים של ${client.name} יימחקו לצמיתות.`, 'מחיקה', async () => {
      await Api.deleteClient(client.id); location.hash = '#/clients';
    });
  }

  /* ---- bots tab ---- */
  async function renderBots(el, client) {
    const { bots } = await Api.listBots(client.id);
    el.innerHTML = `
      <div class="toolbar">
        <span class="page-sub" style="margin:0">${bots.length} בוטים · מילות מפתח גוברות על כל-הודעה</span>
        <div class="grow"></div>
        <button class="btn" id="new-bot">＋ בוט חדש</button>
      </div>
      <div class="bots-grid">
        ${bots.map(b => `
          <div class="bot-card" data-id="${b.id}">
            <div class="top"><h4>${esc(b.name)}</h4>${b.is_live ? '<span class="badge green"><span class="dot"></span>פעיל</span>' : '<span class="badge">מושהה</span>'}</div>
            <div class="trig">${esc(triggerDesc(b))}</div>
            <div class="stats"><span class="num">${b.runs_week ?? 0} ריצות השבוע</span><span>${b.steps?.length || 0} צעדים</span></div>
            <div class="actions">
              <button class="btn secondary small" data-act="edit">עריכה</button>
              <button class="btn ${b.is_live ? 'secondary' : ''} small" data-act="toggle">${b.is_live ? 'השהיה' : 'הפעלה'}</button>
              <button class="btn ghost small" data-act="dup">שכפול</button>
              <button class="btn danger small" data-act="del">מחיקה</button>
            </div>
          </div>`).join('') || '<div class="empty" style="grid-column:1/-1"><div class="big">✦</div>אין בוטים עדיין — יוצרים את הראשון</div>'}
      </div>`;
    el.querySelector('#new-bot').onclick = () => location.hash = `#/client/${client.id}/builder`;
    el.querySelectorAll('.bot-card').forEach(card => {
      const id = +card.dataset.id;
      const bot = bots.find(b => b.id === id);
      card.onclick = (e) => { if (!e.target.dataset.act) location.hash = `#/client/${client.id}/builder/${id}`; };
      card.querySelector('[data-act=edit]').onclick = () => location.hash = `#/client/${client.id}/builder/${id}`;
      card.querySelector('[data-act=toggle]').onclick = async () => { await Api.toggleBot(id, !bot.is_live); toast(bot.is_live ? 'הבוט הושהה' : 'הבוט פעיל'); renderBots(el, client); };
      card.querySelector('[data-act=dup]').onclick = async () => { await Api.duplicateBot(id); toast('הבוט שוכפל (מושהה)'); renderBots(el, client); };
      card.querySelector('[data-act=del]').onclick = () => confirmModal('מחיקת בוט', `הבוט "${bot.name}" יימחק.`, 'מחיקה', async () => { await Api.deleteBot(id); renderBots(el, client); });
    });
  }

  function triggerDesc(b) {
    if (b.trigger_type === 'keywords') return `הודעה נכנסת · מילות מפתח: ${esc(b.keywords || '')}`;
    if (b.trigger_type === 'event') return `אירוע EasyBizy · ${esc(EVENT_LABELS[b.event] || b.event)}`;
    return TRIGGER_LABELS[b.trigger_type] || b.trigger_type;
  }

  /* ---- conversations tab ---- */
  async function renderConvos(el, client) {
    const { conversations } = await Api.listConversations(client.id);
    el.innerHTML = `
      <div class="convo">
        <div class="convo-list">
          <div class="convo-search"><div class="search-input"><input class="input" id="cq" placeholder="חיפוש שם או מספר"></div></div>
          <div id="cl"></div>
        </div>
        <div class="chat" id="chat"><div class="empty" style="margin:auto"><div class="big">✉</div>בחרו שיחה מהרשימה</div></div>
      </div>`;
    let current = null;
    const renderList = () => {
      const q = el.querySelector('#cq').value.trim();
      const rows = conversations.filter(c => !q || (c.customer_name || '').includes(q) || c.contact_phone.includes(q));
      el.querySelector('#cl').innerHTML = rows.map(c => `
        <div class="convo-item ${current === c.id ? 'active' : ''}" data-id="${c.id}">
          <div class="avatar">${esc((c.customer_name || c.contact_phone || '?').trim().charAt(0))}</div>
          <div class="ci-text">
            <div class="ci-top"><span class="ci-name">${esc(c.customer_name || 'ללא שם')}</span><span class="ci-time">${fmtTime(c.last_at)}</span></div>
            <div class="ci-sub">${c.paused ? '■ מועבר לצוות · ' : ''}${esc(c.last_message || '')}</div>
            <div class="ci-sub num" style="direction:ltr;text-align:right">${esc(c.contact_phone)}</div>
          </div>
        </div>`).join('') || '<div class="empty">אין שיחות</div>';
      el.querySelectorAll('.convo-item').forEach(ci => ci.onclick = () => { current = +ci.dataset.id; el.querySelector('.convo').classList.add('chat-open'); renderList(); renderChat(conversations.find(c => c.id === current)); });
    };
    el.querySelector('#cq').oninput = renderList;

    const renderChat = async (c) => {
      if (!c) return;
      const { messages } = await Api.getMessages(c.id);
      el.querySelector('#chat').innerHTML = `
        <div class="chat-head">
          <button class="btn ghost small chat-back" id="back">→ שיחות</button>
          <div class="avatar small">${esc((c.customer_name || c.contact_phone || '?').trim().charAt(0))}</div>
          <div><div class="ch-name">${esc(c.customer_name || 'ללא שם')}</div><div class="ch-phone num">${esc(c.contact_phone)}</div></div>
          <div class="ch-actions">
            ${c.window_open ? `<span class="window-chip open">חלון פתוח · נותרו ${esc(c.window_left || '')}</span>` : '<span class="window-chip closed">חלון סגור — תבנית בלבד</span>'}
            <button class="btn secondary small" id="tpl">שליחת תבנית</button>
            <button class="btn ${c.paused ? '' : 'secondary'} small" id="pause">${c.paused ? 'החזרת בוט' : 'השהיית בוט'}</button>
          </div>
        </div>
        <div class="chat-body" id="cb">
          ${messages.map(m => `
            <div class="bubble ${m.direction === 'outbound' ? 'out' : ''}">
              ${m.template_name ? `<div class="b-header">▤ ${esc(m.template_name)}</div>` : ''}
              ${esc(m.text || '')}
              ${(m.buttons || []).map(b => `<span class="bubble-btn">${esc(b)}</span>`).join('')}
              <div class="meta">${m.sent_by === 'bot' ? 'בוט · ' : m.sent_by === 'team' ? 'צוות · ' : ''}${fmtTime(m.at)} · ${esc(statusLabel(m.delivery_status))}</div>
            </div>`).join('')}
        </div>
        <div class="chat-input">
          <input class="input" id="reply" placeholder="${c.window_open && !c.paused ? 'כתבו תשובה… (שליחה תשהה את הבוט בשיחה)' : c.paused ? 'כתבו תשובה כצוות…' : 'החלון סגור — שליחת תבנית בלבד'}" ${c.window_open ? '' : 'disabled'}>
          <button class="btn" id="send" ${c.window_open ? '' : 'disabled'}>שליחה</button>
        </div>`;
      el.querySelector('#back').onclick = () => { el.querySelector('.convo').classList.remove('chat-open'); };
      const cb = el.querySelector('#cb'); cb.scrollTop = cb.scrollHeight;
      el.querySelector('#pause').onclick = async () => { await Api.pauseConversation(c.id, !c.paused); c.paused = !c.paused; c.status = c.paused ? 'handoff' : 'active'; renderList(); renderChat(c); toast(c.paused ? 'הבוט מושהה בשיחה זו' : 'הבוט חזר לפעול'); };
      el.querySelector('#tpl').onclick = () => templateModal(client, c);
      const doSend = async () => {
        const inp = el.querySelector('#reply'); const text = inp.value.trim();
        if (!text) return;
        await Api.sendMessage(client.id, c.contact_phone, { text });
        if (!c.paused) await Api.pauseConversation(c.id, true);
        c.paused = true; renderChat(c);
      };
      el.querySelector('#send').onclick = doSend;
      el.querySelector('#reply').onkeydown = (e) => { if (e.key === 'Enter') doSend(); };
    };

    clearInterval(state.convoTimer);
    state.convoTimer = setInterval(async () => {
      if (!location.hash.includes('/convos')) return clearInterval(state.convoTimer);
      if (current) { const c = conversations.find(x => x.id === current); if (c) renderChat(c); }
    }, 10000);
    renderList();
    if (conversations.length) { current = conversations[0].id; renderList(); renderChat(conversations[0]); }
  }

  function statusLabel(s) {
    return { sent: 'נשלח', delivered: 'נמסר ✓', failed: 'נכשל', received: 'התקבל' }[s] || s || '';
  }

  async function templateModal(client, convo) {
    const { templates } = await Api.getTemplates(client.id);
    const m = modal(`
      <h3>שליחת תבנית מאושרת</h3>
      ${templates.length ? templates.map((t, i) => `
        <label class="field" style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;cursor:pointer">
          <input type="radio" name="tpl" value="${i}" style="margin-inline-end:8px">${esc(t.name)} <span class="mono" style="color:var(--muted)">(${esc(t.language)})</span>
          <div class="hint" style="margin-top:4px">${esc(t.example || '')}</div>
          <div class="hint">פרמטרים: ${t.params.map(p => esc(p)).join(', ') || 'אין'}</div>
        </label>`).join('') : '<p class="page-sub">אין תבניות מאושרות בחשבון.</p>'}
      <div class="modal-actions">
        <button class="btn" id="tpl-send">שליחה</button>
        <button class="btn secondary" id="tpl-cancel">ביטול</button>
      </div>`);
    m.querySelector('#tpl-cancel').onclick = () => m.remove();
    m.querySelector('#tpl-send').onclick = async () => {
      const sel = m.querySelector('input[name=tpl]:checked');
      if (!sel) return toast('בחרו תבנית');
      const t = templates[+sel.value];
      const params = t.params.map(() => convo.customer_name || '');
      await Api.sendMessage(client.id, convo.contact_phone, { template_name: t.name, params, customer_name: convo.customer_name });
      m.remove(); toast('התבנית נשלחה');
    };
  }

  /* ---- activity tab / page ---- */
  async function renderActivity(el, clientId) {
    const load = async (params) => {
      const { events } = await Api.listActivity(params);
      el.querySelector('#at-body').innerHTML = events.map(e => `
        <tr data-id="${e.id}">
          <td class="num" style="white-space:nowrap">${fmtDateTime(e.received_at)}</td>
          <td>${esc(e.client_name || state.currentClient?.name || '')}</td>
          <td><div class="cell-sub mono">${esc(e.event_type)}</div>${esc(EVENT_LABELS[e.event_type] || '')}</td>
          <td>${resultBadge(e.result)}</td>
          <td class="cell-sub">${esc(e.details || '')}</td>
        </tr>`).join('') || `<tr><td colspan="5"><div class="empty" style="padding:56px 20px"><div class="big">≡</div>אין פעילות עדיין<br><span class="cell-sub" style="font-weight:400">כש-webhook יגיע מ-EasyBizy הוא יופיע כאן עם התוצאה שלו</span></div></td></tr>`;
      el.querySelectorAll('#at-body tr[data-id]').forEach(tr => tr.onclick = () => {
        const e = events.find(x => x.id === +tr.dataset.id);
        modal(`<h3 class="mono" style="direction:ltr;text-align:left">${esc(e.event_type)}</h3>
          <p class="page-sub">${fmtDateTime(e.received_at)} · ${esc(e.client_name || '')} ${e.bot_name ? '· ' + esc(e.bot_name) : ''}</p>
          <pre class="payload">${esc(JSON.stringify(e.payload, null, 2))}</pre>
          <div class="modal-actions"><button class="btn secondary" onclick="this.closest('.modal-back').remove()">סגירה</button></div>`);
      });
    };
    el.innerHTML = `
      <div class="filters">
        ${clientId ? '' : `<select class="input" id="af-client"><option value="">כל הלקוחות</option>${state.clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`}
        <select class="input" id="af-event"><option value="">כל האירועים</option>${ALL_EVENTS.map(ev => `<option value="${ev}">${esc(EVENT_LABELS[ev])}</option>`).join('')}</select>
        <select class="input" id="af-result"><option value="">כל התוצאות</option><option value="bot_ran">בוט רץ</option><option value="failed">שגיאות בלבד</option><option value="no_bot">אין בוט</option></select>
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>זמן</th><th>לקוח</th><th>אירוע</th><th>תוצאה</th><th>פרטים</th></tr></thead><tbody id="at-body"></tbody></table></div>`;
    const params = () => ({
      client_id: clientId || el.querySelector('#af-client')?.value,
      event_type: el.querySelector('#af-event').value,
      result: el.querySelector('#af-result').value,
    });
    el.querySelectorAll('.filters select').forEach(s => s.onchange = () => load(params()));
    await load(params());
  }

  async function viewActivityPage() {
    clearInterval(state.convoTimer);
    await Api.listClients().then(r => state.clients = r.clients);
    shell('activity', `
      <div class="page-head"><h1>פעילות</h1></div>
      <p class="page-sub">כל webhook ש-EasyBizy שלחה, מה האפליקציה עשתה איתו, וכל הודעה שנכשלה — לצורך פתרון תקלות.</p>
      <div id="abody"></div>`);
    renderActivity(document.getElementById('abody'), null);
  }

  /* ---------------- bot builder ---------------- */
  async function viewBuilder(clientId, botId) {
    clearInterval(state.convoTimer);
    const { client } = await Api.getClient(clientId);
    const { templates } = await Api.getTemplates(clientId).catch(() => ({ templates: [] }));
    let bot = botId
      ? (await Api.getBot(botId)).bot
      : { name: '', trigger_type: 'keywords', keywords: '', event: 'leads.create', steps: [], window_closed_template: '', is_live: false };
    if (typeof bot.steps === 'string') bot.steps = JSON.parse(bot.steps);

    shell('clients', `
      <a class="back-link" href="#/client/${clientId}/bots">→ הבוטים של ${esc(client.name)}</a>
      <div class="page-head" style="margin-top:10px">
        <h1 id="bname-title">${esc(bot.name || 'בוט חדש')}</h1>
        <div class="grow"></div>
        <button class="btn secondary" id="send-test">שליחת טסט לנייד שלי</button>
        <button class="btn" id="save">שמירה</button>
      </div>
      <div class="builder">
        <div>
          <div class="card">
            <h3>מתי הבוט מתחיל</h3>
            <div class="grid-2">
              <label class="field"><span>טריגר</span>
                <select class="input" id="trig">
                  <option value="keywords">הודעה עם מילות מפתח</option>
                  <option value="any_message">כל הודעה נכנסת</option>
                  <option value="first_message">הודעה ראשונה של לקוח</option>
                  <option value="event">אירוע EasyBizy</option>
                </select></label>
              <label class="field" id="kw-wrap"><span>מילות מפתח (מופרדות בפסיק)</span>
                <input class="input" id="kw" value="${esc(bot.keywords || '')}" placeholder="תור, book, appointment"></label>
              <label class="field" id="ev-wrap" style="display:none"><span>אירוע</span>
                <select class="input" id="ev">${ALL_EVENTS.filter(e => !e.startsWith('whatsapp-messages')).map(e => `<option value="${e}">${esc(EVENT_LABELS[e])}</option>`).join('')}</select></label>
              <label class="field"><span>תבנית כשהחלון סגור</span>
                <select class="input" id="wct"><option value="">— ללא —</option>${templates.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}</select>
                <span class="hint">אם עברו 24 שעות מההודעה האחרונה של הלקוח, צעדי טקסט יוחלפו בתבנית הזו</span></label>
            </div>
            <label class="field"><span>שם הבוט</span><input class="input" id="bname" value="${esc(bot.name)}" placeholder="עוזר קביעת תור"></label>
          </div>
          <div class="card">
            <h3>צעדים</h3>
            <div id="steps"></div>
            <button class="btn secondary" id="add-step">＋ הוספת צעד</button>
          </div>
        </div>
        <div class="phone"><div class="phone-title">תצוגה מקדימה</div><div id="preview"></div></div>
      </div>`, { client, section: 'bots' });

    const $ = (s) => document.querySelector(s);
    $('#trig').value = bot.trigger_type;
    $('#ev').value = bot.event || 'leads.create';
    $('#wct').value = bot.window_closed_template || '';

    const syncTrig = () => {
      $('#kw-wrap').style.display = $('#trig').value === 'keywords' ? '' : 'none';
      $('#ev-wrap').style.display = $('#trig').value === 'event' ? '' : 'none';
    };
    $('#trig').onchange = syncTrig; syncTrig();

    function renderSteps() {
      $('#steps').innerHTML = bot.steps.map((s, i) => stepHtml(s, String(i), i + 1, false)).join('') || '<div class="empty" style="padding:20px">אין צעדים — הבוט לא יעשה כלום בלעדיהם</div>';
      $('#steps').querySelectorAll('.step').forEach(stepEl => {
        const p = stepEl.dataset.path.split(':').map(Number); // [i] or [i, optIdx, k]
        stepEl.querySelector('[data-a=edit]').onclick = () => stepModal(bot, p, () => renderSteps());
        stepEl.querySelector('[data-a=up]').onclick = () => { move(p, -1); renderSteps(); };
        stepEl.querySelector('[data-a=down]').onclick = () => { move(p, 1); renderSteps(); };
        stepEl.querySelector('[data-a=del]').onclick = () => { move(p, null); renderSteps(); };
      });
      $('#steps').querySelectorAll('[data-addbranch]').forEach(btn => {
        const [i, oi] = btn.dataset.addbranch.split(':').map(Number);
        btn.onclick = () => stepModal(bot, null, (out) => {
          const opt = bot.steps[i].options[oi];
          bot.steps[i].branches[opt.value] = bot.steps[i].branches[opt.value] || [];
          bot.steps[i].branches[opt.value].push(out);
          renderSteps();
        });
      });
      renderPreview();
    }

    function stepHtml(s, path, num, isBranch) {
      const desc = describeStep(s);
      const branches = s.type === 'buttons' && !isBranch
        ? (s.options || []).map((o, oi) => `
            <div class="branch-label">אם נלחץ ״${esc(o.label)}״ <button class="icon-btn" data-addbranch="${path.split(':')[0]}:${oi}" title="הוספת צעד לענף">＋</button></div>
            ${((s.branches || {})[o.value] || []).map((bs, k) => stepHtml(bs, `${path}:${oi}:${k}`, `${num}.${k + 1}`, true)).join('') || '<div class="branch-label" style="font-weight:400;color:var(--muted)">אין צעדים בענף</div>'}`)
          .join('') : '';
      return `<div class="step ${isBranch ? 'branch-step' : ''}" data-path="${path}">
          <div class="step-head">
            <span class="step-num">${num}</span>
            <span class="step-type">${esc(STEP_TYPES[s.type] || s.type)}</span>
            <span class="step-actions">
              <button class="icon-btn" data-a="edit" title="עריכה">✎</button>
              <button class="icon-btn" data-a="up" title="למעלה">↑</button>
              <button class="icon-btn" data-a="down" title="למטה">↓</button>
              <button class="icon-btn" data-a="del" title="מחיקה">🗑</button>
            </span>
          </div>
          <div class="step-body">${esc(desc)}</div>
        </div>${branches}`;
    }

    function move(p, dir) {
      const arr = p.length === 1 ? bot.steps : bot.steps[p[0]].branches[bot.steps[p[0]].options[p[1]].value];
      const idx = p.length === 1 ? p[0] : p[2];
      if (dir === null) { arr.splice(idx, 1); return; }
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
    }

    function describeStep(s) {
      switch (s.type) {
        case 'text': return s.text;
        case 'buttons': return `${s.text} ← ${(s.options || []).map(o => o.label).join(' · ')}`;
        case 'link': return `${s.text} ← ${s.url}`;
        case 'file': return `קובץ (mediaId: ${s.mediaId || '—'})${s.caption ? ' · ' + s.caption : ''}`;
        case 'template': return `תבנית ${s.templateName}${s.params?.length ? ' · ' + s.params.join(', ') : ''}`;
        case 'question': return `${s.text} ← נשמר כ-${s.saveAs || '?'}`;
        case 'condition': return `אם ${s.field} ${s.op || 'מכיל'} "${s.value || ''}"`;
        case 'easybizy_action': return { create_lead: 'יצירת ליד', create_customer: 'יצירת לקוח', add_activity: 'הוספת הערה' }[s.action] || s.action;
        case 'handoff': return 'הבוט עוצר והשיחה עוברת לצוות';
        default: return '';
      }
    }

    function renderPreview() {
      $('#preview').innerHTML = bot.steps.slice(0, 4).map(s => {
        if (s.type === 'buttons') return `<div class="bubble out">${esc(s.text)}${(s.options || []).map(o => `<span class="bubble-btn">${esc(o.label)}</span>`).join('')}<div class="meta">בוט</div></div>`;
        if (s.type === 'link') return `<div class="bubble out">${esc(s.text)}<span class="bubble-btn">⤴ ${esc(s.buttonLabel || s.url)}</span><div class="meta">בוט</div></div>`;
        if (s.type === 'template') return `<div class="bubble out"><div class="b-header">▤ ${esc(s.templateName)}</div>תבנית מאושרת<div class="meta">בוט</div></div>`;
        if (s.type === 'handoff') return `<div class="bubble out" style="background:#fff3cd">■ הבוט מושהה — השיחה עוברת לצוות</div>`;
        if (s.type === 'easybizy_action') return '';
        if (s.type === 'condition') return '';
        return `<div class="bubble out">${esc(s.text || s.caption || '')}<div class="meta">בוט</div></div>`;
      }).join('') || '<div class="empty" style="color:var(--muted)">הוסיפו צעד לתצוגה</div>';
    }

    $('#add-step').onclick = () => stepModal(bot, null, (out) => { bot.steps.push(out); renderSteps(); });

    $('#save').onclick = async () => {
      const body = {
        ...bot,
        name: $('#bname').value.trim(),
        trigger_type: $('#trig').value,
        keywords: $('#kw').value.trim(),
        event: $('#ev').value,
        window_closed_template: $('#wct').value,
        steps: bot.steps,
      };
      if (!body.name) return toast('חסר שם לבוט');
      const saved = await Api.saveBot(clientId, body);
      toast('הבוט נשמר');
      location.hash = `#/client/${clientId}/bots`;
    };
    $('#send-test').onclick = () => toast('שליחת טסט תעבוד אחרי חיבור ה-backend');
    renderSteps();
  }

  function stepModal(bot, p, onDone) {
    // p: [i] to edit top-level step i, [i, oi, k] to edit branch step, or null to add a new top-level step
    const isBranch = p && p.length === 3;
    const editing = p !== null;
    const s = !editing ? { type: 'text' } : isBranch ? bot.steps[p[0]].branches[bot.steps[p[0]].options[p[1]].value][p[2]] : bot.steps[p[0]];
    const m = modal(`
      <h3>${editing ? 'עריכת צעד' : 'צעד חדש'}</h3>
      <label class="field"><span>סוג צעד</span>
        <select class="input" id="st-type">${Object.entries(STEP_TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <div id="st-fields"></div>
      <div class="modal-actions">
        <button class="btn" id="st-save">${editing ? 'שמירה' : 'הוספה'}</button>
        <button class="btn secondary" id="st-cancel">ביטול</button>
      </div>`);
    const typeSel = m.querySelector('#st-type');
    typeSel.value = s.type || 'text';
    const fields = m.querySelector('#st-fields');

    const renderFields = () => {
      const t = typeSel.value;
      fields.innerHTML = {
        text: `<label class="field"><span>טקסט ההודעה</span><textarea class="input" id="f-text" rows="3">${esc(s.text || '')}</textarea><span class="hint">משתנים: {customerName}, {appointment.startTime}, {lead.name}, {answers.x}</span></label>`,
        buttons: `<label class="field"><span>טקסט ההודעה</span><textarea class="input" id="f-text" rows="2">${esc(s.text || '')}</textarea></label>
          <label class="field"><span>כפתורים (שורה לכל אחד: תווית=ערך)</span><textarea class="input" id="f-options" rows="3" dir="rtl">${(s.options || []).map(o => `${o.label}=${o.value}`).join('\n')}</textarea><span class="hint">עד 3 כפתורים; 4–10 הופכים לרשימה. לכל כפתור ייפתח ענף צעדים משלו.</span></label>
          <label class="field"><span>כותרת לרשימה (חובה מעל 3)</span><input class="input" id="f-buttonsTitle" value="${esc(s.buttonsTitle || '')}"></label>`,
        link: `<label class="field"><span>טקסט</span><textarea class="input" id="f-text" rows="2">${esc(s.text || '')}</textarea></label>
          <label class="field"><span>כתובת</span><input class="input" dir="ltr" id="f-url" value="${esc(s.url || '')}"></label>
          <label class="field"><span>תווית כפתור</span><input class="input" id="f-buttonLabel" value="${esc(s.buttonLabel || '')}"></label>`,
        file: `<label class="field"><span>mediaId (מהעלאה ב-EasyBizy)</span><input class="input" dir="ltr" id="f-mediaId" value="${esc(s.mediaId || '')}"></label>
          <label class="field"><span>כיתוב</span><input class="input" id="f-caption" value="${esc(s.caption || '')}"></label>`,
        template: `<label class="field"><span>שם התבנית</span><input class="input" dir="ltr" id="f-templateName" value="${esc(s.templateName || '')}"></label>
          <label class="field"><span>פרמטרים (מופרדים בפסיק, אפשר משתנים)</span><input class="input" id="f-params" value="${esc((s.params || []).join(', '))}"></label>`,
        question: `<label class="field"><span>השאלה</span><textarea class="input" id="f-text" rows="2">${esc(s.text || '')}</textarea></label>
          <label class="field"><span>נשמר כמשתנה</span><input class="input" dir="ltr" id="f-saveAs" value="${esc(s.saveAs || '')}"></label>`,
        condition: `<label class="field"><span>שדה</span><input class="input" dir="ltr" id="f-field" value="${esc(s.field || '')}"></label>
          <label class="field"><span>תנאי</span><select class="input" id="f-op"><option value="contains">מכיל</option><option value="eq">שווה ל-</option><option value="exists">קיים</option></select></label>
          <label class="field"><span>ערך</span><input class="input" id="f-value" value="${esc(s.value || '')}"></label>`,
        easybizy_action: `<label class="field"><span>פעולה</span><select class="input" id="f-action"><option value="create_lead">יצירת ליד</option><option value="create_customer">יצירת לקוח</option><option value="add_activity">הוספת הערה ללקוח</option></select></label>
          <label class="field"><span>תוכן / הערה</span><textarea class="input" id="f-note" rows="2">${esc(s.note || '')}</textarea></label>`,
        handoff: `<p class="page-sub">הבוט עוצר, והשיחה מסומנת כ״ממתין לצוות״ עד שמחזירים את הבוט.</p>`,
      }[t] || '';
      if (t === 'easybizy_action' && s.action) fields.querySelector('#f-action').value = s.action;
      if (t === 'condition' && s.op) fields.querySelector('#f-op').value = s.op;
    };
    typeSel.onchange = renderFields;
    renderFields();

    m.querySelector('#st-cancel').onclick = () => m.remove();
    m.querySelector('#st-save').onclick = () => {
      const t = typeSel.value;
      const v = (id) => fields.querySelector(id)?.value ?? '';
      const out = { type: t };
      if (t === 'text') out.text = v('#f-text');
      if (t === 'buttons') {
        out.text = v('#f-text');
        out.options = v('#f-options').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
          const [label, value] = l.split('=').map(x => x.trim());
          return { label, value: value || label };
        }).slice(0, 10);
        if (v('#f-buttonsTitle')) out.buttonsTitle = v('#f-buttonsTitle');
        if (out.options.length > 3 && !out.buttonsTitle) return toast('מעל 3 אפשרויות חובה כותרת לרשימה');
        if (!out.options.length) return toast('חסרים כפתורים');
        out.branches = s.branches || {};
        out.options.forEach(o => out.branches[o.value] = out.branches[o.value] || []);
      }
      if (t === 'link') { out.text = v('#f-text'); out.url = v('#f-url'); out.buttonLabel = v('#f-buttonLabel'); }
      if (t === 'file') { out.mediaId = v('#f-mediaId'); out.caption = v('#f-caption'); }
      if (t === 'template') { out.templateName = v('#f-templateName'); out.params = v('#f-params').split(',').map(x => x.trim()).filter(Boolean); }
      if (t === 'question') { out.text = v('#f-text'); out.saveAs = v('#f-saveAs'); }
      if (t === 'condition') { out.field = v('#f-field'); out.op = v('#f-op'); out.value = v('#f-value'); }
      if (t === 'easybizy_action') { out.action = v('#f-action'); out.note = v('#f-note'); }
      if (!editing) { m.remove(); onDone(out); return; }
      if (isBranch) bot.steps[p[0]].branches[bot.steps[p[0]].options[p[1]].value][p[2]] = out;
      else bot.steps[p[0]] = out;
      m.remove(); onDone();
    };
  }

  /* ---------------- bots overview page ---------------- */
  /* ---------------- router ---------------- */
  function route() {
    const h = location.hash || '#/clients';
    if (!Api.isLoggedIn() && h !== '#/login') return viewLogin();
    const [, page, a, b] = h.split('/');
    if (h === '#/login') return viewLogin();
    if (page === 'clients') return viewClients(a === 'new');
    if (page === 'activity') return viewActivityPage();
    if (page === 'client' && a) {
      const parts = h.split('/');
      if (parts[3] === 'builder') return viewBuilder(a, parts[4] || null);
      if (parts[3] === 'automation') return viewAutomation(a, parts[4] || null);
      return viewClient(a, parts[3] || 'setup');
    }
    viewClients();
  }
  window.addEventListener('hashchange', route);
  route();
})();
