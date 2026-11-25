/* WA Manager — router and views. */
(() => {
  const { esc, fmtTime, fmtAgo, fmtDateTime, statusBadge, qualityBadge, resultBadge, toast, modal, confirmModal, EVENT_LABELS, ALL_EVENTS, TRIGGER_LABELS, STEP_TYPES, AUTOMATION_ACTIONS } = UI;
  const root = document.getElementById('app');
  let state = { clients: [], currentClient: null, convoTimer: null };

  /* ---- variable chips: tappable tokens, no manual braces ---- */
  const VAR_LABELS = { customerName: 'שם הלקוח', 'lead.name': 'שם הליד', 'appointment.startTime': 'מועד התור' };
  function varPills(escaped) {
    return escaped.replace(/\{([A-Za-z0-9_.]+)\}/g, (m, k) => `<span class="var-pill">${esc(VAR_LABELS[k] || (k.startsWith('answers.') ? 'תשובה: ' + k.slice(8) : k))}</span>`);
  }
  function varChipsHTML(vars) {
    if (!vars.length) return '';
    return `<div class="var-chips">${vars.map(([label, token]) => `<button type="button" class="var-chip" data-token="${esc(token)}">${esc(label)}</button>`).join('')}</div>`;
  }
  function insertAtCursor(field, token) {
    if (!field) return;
    const s = field.selectionStart ?? field.value.length, e = field.selectionEnd ?? field.value.length;
    field.value = field.value.slice(0, s) + token + field.value.slice(e);
    try { field.selectionStart = field.selectionEnd = s + token.length; } catch {}
    field.focus();
  }
  function wireVarChips(scopeEl) {
    scopeEl.querySelectorAll('.var-chips').forEach(box => {
      const field = box.parentElement.querySelector('textarea.input, input.input');
      let lastTouch = 0;
      box.querySelectorAll('.var-chip').forEach(chip => {
        const insert = () => insertAtCursor(field, chip.dataset.token);
        chip.addEventListener('touchstart', e => { e.preventDefault(); lastTouch = Date.now(); insert(); }, { passive: false });
        chip.addEventListener('mousedown', e => e.preventDefault());
        chip.addEventListener('click', () => { if (Date.now() - lastTouch > 600) insert(); });
      });
    });
  }
  function collectQuestionNames(steps, out = []) {
    (steps || []).forEach(s => {
      if (s.type === 'question' && s.saveAs && !out.includes(s.saveAs)) out.push(s.saveAs);
      Object.values(s.branches || {}).forEach(b => collectQuestionNames(b, out));
    });
    return out;
  }
  function eventVars(triggerEvent) {
    const vars = [['שם הלקוח', '{customerName}']];
    if ((triggerEvent || '').startsWith('leads')) vars.push(['שם הליד', '{lead.name}']);
    if ((triggerEvent || '').startsWith('appointments')) vars.push(['מועד התור', '{appointment.startTime}']);
    return vars;
  }
  function botVars(bot) {
    const vars = eventVars(bot.trigger_type === 'event' ? bot.event : '');
    collectQuestionNames(bot.steps).forEach(n => vars.push([`תשובה: ${n}`, `{answers.${n}}`]));
    return vars;
  }

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
  const CLIENT_SECTIONS = [['dash', 'דשבורד', '▣'], ['setup', 'הגדרה', '▤'], ['bots', 'בוטים', '✦'], ['automations', 'אוטומציות', '⚡'], ['activity', 'פעילות', '≡']];

  /* active: 'clients' for the global list. clientNav: { client, section } renders
     the sidebar as that client's menu instead. */
  function shell(active, inner, clientNav, brand) {
    const who = `
          <div class="who">
            ${Api.demoMode ? '<span class="demo-pill">מצב הדגמה</span> Tech Mate · עידן' : Api.isLoggedIn() ? `<span class="num" style="font-size:12px">${esc(sessionStorage.getItem('wa_email') || '')}</span>` : '<span class="demo-pill">תצוגת דמו</span>'}
            ${Api.isLoggedIn() ? '<div style="margin-top:6px"><a href="#" id="logout">התנתקות</a></div>' : ''}
          </div>`;
    const nav = clientNav ? `
          <a class="back-link" href="#/clients" style="padding:4px 12px">→ כל הלקוחות</a>
          <div class="client-nav-head">
            <div class="cn-name">${esc(clientNav.client.name)}</div>
            ${statusBadge(clientNav.client.connection_status)}
          </div>
          ${CLIENT_SECTIONS.map(([k, l, ico]) => `<a class="nav-item ${clientNav.section === k ? 'active' : ''}" href="#/client/${clientNav.client.id}/${k}"><span class="ico">${ico}</span> ${l}</a>`).join('')}`
        : brand === 'clinic' ? `
          <a class="nav-item ${active === 'board' && !/#\/board\/(mapping|fieldmap|workplan)/.test(location.hash) ? 'active' : ''}" href="#/board"><span class="ico">◔</span> דשבורד ניהול (דמו)</a>
          <a class="nav-item ${location.hash.startsWith('#/board/mapping') ? 'active' : ''}" href="#/board/mapping"><span class="ico">⛓</span> מיפוי קיים כיום</a>
          <a class="nav-item ${location.hash.startsWith('#/board/fieldmap') ? 'active' : ''}" href="#/board/fieldmap"><span class="ico">▤</span> מיפוי שדות הדשבורד</a>
          <a class="nav-item ${location.hash.startsWith('#/board/workplan') ? 'active' : ''}" href="#/board/workplan"><span class="ico">▦</span> משימות להמשך (מהאפיון)</a>`
        : `
          <a class="nav-item ${active === 'clients' ? 'active' : ''}" href="#/clients"><span class="ico">▦</span> לקוחות</a>
          ${Api.demoMode || !Api.isLoggedIn() ? `<a class="nav-item ${active === 'board' ? 'active' : ''}" href="#/board"><span class="ico">◔</span> דשבורד ניהול (דמו)</a>` : ''}`;
    root.innerHTML = `
      <div class="layout">
        <div class="topbar">
          <button class="icon-btn" id="nav-burger" title="תפריט">☰</button>
          ${brand === 'clinic'
            ? '<span class="brand"><img class="logo brand-light-only" src="assets/clinic-logo-dark.png" alt="Dr. Ziv Peretz" style="width:auto;height:28px;border-radius:0"><img class="logo brand-dark-only" src="assets/clinic-logo-white.png" alt="Dr. Ziv Peretz" style="width:auto;height:28px;border-radius:0"> דשבורד ניהול</span>'
            : '<span class="brand"><img class="logo" src="assets/logo-icon.png" alt="Tech Mate"> WhatsApp Manager</span>'}
          <button class="icon-btn" id="theme-toggle" title="מצב כהה / בהיר">◐</button>
        </div>
        <div class="nav-overlay" id="nav-overlay"></div>
        <aside class="sidebar">
          ${brand === 'clinic'
            ? '<div class="brand column"><img class="logo-lg brand-light-only" src="assets/clinic-logo-dark.png" alt="Dr. Ziv Peretz" style="width:120px;border-radius:0"><img class="logo-lg brand-dark-only" src="assets/clinic-logo-white.png" alt="Dr. Ziv Peretz" style="width:120px;border-radius:0"><span class="brand-name">דשבורד ניהול<span class="brand-sub">Dr. Ziv Peretz · Aesthetic Clinic</span></span></div>'
            : '<div class="brand column"><img class="logo-lg" src="assets/logo-icon.png" alt="Tech Mate"><span class="brand-name">WhatsApp Manager<span class="brand-sub">for EasyBizy</span></span></div>'}
          ${nav}
          <div class="spacer"></div>
          ${who}
        </aside>
        <main class="main">${inner}</main>
      </div>`;
    const logoutEl = document.getElementById('logout');
    if (logoutEl) logoutEl.onclick = (e) => { e.preventDefault(); Api.logout(); };
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
        <img class="logo" src="assets/logo-full.png" alt="Tech Mate">
        <h1>WhatsApp Manager<span class="brand-sub" style="font-size:13px">for EasyBizy</span></h1>
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
        <img class="logo" src="assets/logo-full.png" alt="Tech Mate">
        <h1>WhatsApp Manager<span class="brand-sub" style="font-size:13px">for EasyBizy</span></h1>
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
  async function viewClient(id, tab = 'dash') {
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
    if (tab === 'dash') renderDash(body, client);
    if (tab === 'setup') renderSetup(body, client);
    if (tab === 'bots') renderBots(body, client);
    if (tab === 'automations') renderAutomations(body, client);
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

    const aVars = eventVars(auto.trigger_event);
    async function renderActionFields() {
      const a = AUTOMATION_ACTIONS[actionSel.value];
      guideEl.textContent = a.guidance;
      if (actionSel.value === 'send_template' && !templates.length) {
        fieldsEl.innerHTML = '<div class="hint">טוען תבניות…</div>';
        try { templates = (await Api.listAllTemplates(client.id)).templates || []; } catch { templates = []; }
      }
      fieldsEl.innerHTML = a.fields.map(f => {
        const val = esc(auto.config[f.k] || '');
        if (actionSel.value === 'send_template' && f.k === 'template_name') {
          const cur = auto.config.template_name || '';
          const names = templates.map(t => t.name);
          const isManual = cur && !names.includes(cur);
          const eff = isManual || !templates.length ? cur : (cur || names[0]);
          const opts = templates.map(t => `<option value="${esc(t.name)}" ${!isManual && eff === t.name ? 'selected' : ''}>${esc(t.name)} · ${esc(t.language || 'he')}</option>`).join('')
            + `<option value="__manual" ${isManual || !templates.length ? 'selected' : ''}>✏️ הקלדה ידנית…</option>`;
          return `<label class="field"><span>${esc(f.label)} (מהרשימה שלך או ידנית)</span>
            <select class="input" id="au-tpl-sel" dir="ltr">${opts}</select>
            <input class="input" data-k="${f.k}" id="au-tpl-manual" dir="ltr" style="margin-top:8px;${isManual || !templates.length ? '' : 'display:none'}" value="${esc(eff)}" placeholder="שם התבנית בדיוק כפי שמופיע ב-EasyBizy">
            <span class="hint" id="tpl-example"></span>
            <span class="hint">השם חייב להתאים לתבנית מאושרת במסוף EasyBizy. ניהול הרשימה: הגדרה ← התבניות שלי.</span></label>`;
        }
        if (f.textarea) return `<label class="field"><span>${esc(f.label)}</span><textarea class="input" data-k="${f.k}" rows="3" placeholder="${esc(f.placeholder || '')}">${val}</textarea><span class="hint">הקשה על משתנה מוסיפה אותו במיקום הסמן:</span>${varChipsHTML(aVars)}</label>`;
        return `<label class="field"><span>${esc(f.label)}</span><input class="input" data-k="${f.k}" ${f.ltr ? 'dir="ltr"' : ''} value="${val}" placeholder="${esc(f.placeholder || '')}"></label>`;
      }).join('');
      wireVarChips(fieldsEl);
      const tplSel = fieldsEl.querySelector('#au-tpl-sel');
      if (tplSel) {
        const manual = fieldsEl.querySelector('#au-tpl-manual');
        tplSel.onchange = () => {
          const isM = tplSel.value === '__manual';
          manual.style.display = isM ? 'block' : 'none';
          if (!isM) manual.value = tplSel.value;
          else if (templates.some(t => t.name === manual.value)) manual.value = '';
          const t = templates.find(x => x.name === tplSel.value);
          fieldsEl.querySelector('#tpl-example').textContent = !isM && t?.example ? 'תצוגה: ' + t.example : '';
        };
        const t0 = templates.find(x => x.name === tplSel.value);
        if (t0?.example) fieldsEl.querySelector('#tpl-example').textContent = 'תצוגה: ' + t0.example;
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
    const ck = (ev, req) => {
      const seen = client.events_seen?.includes(ev);
      return `<div class="ck ${seen ? 'seen' : ''}"><span class="box">${seen ? '✓' : ''}</span><span>${esc(EVENT_LABELS[ev])}</span>${req ? `<span class="ck-req">${esc(req)}</span>` : ''}<span class="mono" style="color:var(--muted);font-size:11.5px">${esc(ev)}</span><span class="ck-state">${seen ? 'התקבל' : 'עוד לא התקבל'}</span></div>`;
    };
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
            <div style="display:flex;gap:8px">
              <input class="input" dir="ltr" id="wh-url" value="${esc((CONFIG.WORKER_URL || 'https://wa-manager.idanatwork.workers.dev') + '/hook/' + client.webhook_token)}" readonly style="flex:1">
              <button class="btn secondary small" id="wh-copy" type="button">העתקה</button>
            </div>
            <span class="hint">כתובת ייחודית ללקוח הזה — מדביקים אותה במסוף EasyBizy ← Webhooks כדי שיעבירו אליה אירועים; בלעדיה הבוטים לא יגיבו לתשובות לקוחות.</span>
          </label>
          <label class="field"><span>סוד webhook (כותרת X-Webhook-Secret)</span>
            <input class="input" dir="ltr" type="password" id="wh-secret" placeholder="${client.webhook_secret_set ? 'שמור — הקלידו חדש להחלפה' : 'אופציונלי, מומלץ'}">
            <span class="hint">EasyBizy אינה חותמת על משלוחים; הכותרת היא הדרך לוודא שרק היא קוראת לנו.</span>
          </label>
          <button class="btn secondary small" id="wh-save">שמירת סוד</button>
        </div>
      </div>
      <div class="card">
        <h3>התבניות שלי (WhatsApp)</h3>
        <p class="page-sub" style="margin-bottom:12px">חבילת EasyBizy הנוכחית לא מאפשרת קריאת תבניות דרך ה-API, לכן שומרים כאן את שמות התבניות — והן מופיעות לבחירה בבוטים, באוטומציות ובשיחות. השם חייב להתאים בדיוק לתבנית מאושרת במסוף EasyBizy.</p>
        <div id="tpl-list"></div>
        <div style="display:flex;gap:10px;margin-top:10px">
          <input class="input" dir="ltr" id="tpl-new" placeholder="שם תבנית, למשל appointment_reminder">
          <button class="btn" id="tpl-add">הוספה</button>
        </div>
      </div>
      <div class="card">
        <h3>אירועים להפעלה במסוף EasyBizy</h3>
        <p class="page-sub" style="margin-bottom:6px">במסוף EasyBizy ← Webhooks מסמנים את כל האירועים הבאים, כדי ש-EasyBizy תעביר אותם אלינו דרך הכתובת למעלה. ליד כל אירוע כתוב אם הוא כבר הגיע אלינו בפועל.</p>
        <div class="checklist">
          <div class="ck-group">אירועים עסקיים — מפעילים אוטומציות ובוטים שמוגדרים לפי אירוע</div>
          ${ALL_EVENTS.filter(ev => !ev.startsWith('whatsapp')).map(ev => ck(ev)).join('')}
          <div class="ck-group">הודעות וואטסאפ — מעקב אחר הודעות נכנסות וסטטוס מסירה</div>
          ${['whatsapp-messages.received'].map(ev => ck(ev, 'חובה — בלעדיו הבוטים לא יקבלו תשובות מלקוחות')).join('')}
          ${ALL_EVENTS.filter(ev => ev.startsWith('whatsapp') && ev !== 'whatsapp-messages.received').map(ev => ck(ev)).join('')}
        </div>
      </div>
      <div class="card">
        <h3>איזור מסוכן</h3>
        <button class="btn danger" id="del">מחיקת הלקוח וכל הנתונים שלו</button>
      </div>`;

    const tplList = el.querySelector('#tpl-list');
    const renderTplList = async () => {
      const { templates: mine } = await Api.getMyTemplates(client.id);
      tplList.innerHTML = mine.length
        ? mine.map(t => `<div class="kv"><span class="v mono" dir="ltr">${esc(t.name)}</span><button class="btn danger small" data-tpl="${t.id}">מחיקה</button></div>`).join('')
        : '<div class="hint">אין תבניות שמורות עדיין.</div>';
      tplList.querySelectorAll('[data-tpl]').forEach(b => b.onclick = async () => { await Api.deleteMyTemplate(client.id, b.dataset.tpl); renderTplList(); });
    };
    el.querySelector('#tpl-add').onclick = async () => {
      const inp = el.querySelector('#tpl-new');
      const name = inp.value.trim();
      if (!name) return;
      await Api.addMyTemplate(client.id, name);
      inp.value = '';
      renderTplList();
    };
    renderTplList();
    el.querySelector('#edit').onclick = () => clientModal(client);
    el.querySelector('#test').onclick = async () => {
      const btn = el.querySelector('#test'); btn.disabled = true; btn.textContent = 'בודק…';
      const res = await Api.testClient(client.id);
      btn.disabled = false; btn.textContent = 'בדיקת חיבור';
      el.querySelector('#test-result').innerHTML = res.ok
        ? `<div style="margin-top:12px">${statusBadge('connected')} <b class="num">${esc(res.whatsapp_number || '')}</b> · ${qualityBadge(res.quality_rating)} · יתרה יומית: <span class="num">${res.balance?.used_24h ?? 0}/${res.balance?.limit_24h ?? '—'}</span></div>`
        : `<div style="margin-top:12px">${statusBadge('key_rejected')} <span style="color:var(--red)">${esc(res.error || 'החיבור נכשל')}</span></div>`;
    };
    el.querySelector('#wh-copy').onclick = async () => {
      const inp = el.querySelector('#wh-url');
      try { await navigator.clipboard.writeText(inp.value); toast('הכתובת הועתקה'); }
      catch { inp.select(); document.execCommand('copy'); toast('הכתובת הועתקה'); }
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


  /* ---- dashboard tab ---- */

  // Reference-style chart: olive bars, dashed gridlines, values on top, white hover tooltip
  function c2chart(values, opts = {}) {
    const labels = opts.labels || [];
    const seg = opts.seg || null;
    const totals = values.map((v, i) => v + (seg ? seg[i] : 0));
    const mx = Math.max(1, ...totals);
    const step = Math.max(1, Math.ceil(mx / 4));
    const vmax = step * 4;
    const ylabels = [4, 3, 2, 1, 0].map(k => `<span style="top:${k * 25}%">${vmax - k * step}</span>`).join('');
    const grid = [0, 1, 2, 3].map(k => `<div class="c2-grid" style="top:${k * 25}%"></div>`).join('');
    const bars = values.map((v, i) => {
      const h = Math.round(totals[i] / vmax * 100);
      const tip = opts.tip ? opts.tip(i) : String(v);
      const errSeg = seg && seg[i] ? `<span class="seg-err" style="height:${Math.round(seg[i] / totals[i] * 100)}%"></span>` : '';
      return `<div class="c2-col" data-tip="${tip}"><span class="c2-val num">${v}</span><div class="c2-bar" style="height:${h}%">${errSeg}</div></div>`;
    }).join('');
    const xlab = labels.map(l => `<span>${l}</span>`).join('');
    const conv = opts.convRow ? `<div class="c2-x c2-conv">${opts.convRow.map(l => `<span>${l}</span>`).join('')}</div>` : '';
    return `<div class="c2"><div class="c2-y">${ylabels}</div><div class="c2-plot">${grid}<div class="c2-axis"></div><div class="c2-bars">${bars}</div></div></div><div class="c2-x">${xlab}</div>${conv}`;
  }

  async function renderDash(el, client) {
    const { dash } = await Api.getDash(client.id);
    const chartHtml = c2chart(dash.days.map(d => d.runs), {
      seg: dash.days.map(d => d.errors),
      labels: dash.days.map((d, i) => (i % 2 === 0 ? `${d.date.slice(8)}.${d.date.slice(5, 7)}` : '')),
      tip: (i) => `${dash.days[i].date}\nריצות: ${dash.days[i].runs}\nשגיאות: ${dash.days[i].errors}`,
    });
    el.innerHTML = `
      <div class="dash-grid">
        <div class="stat"><div class="s-label">חיבור</div><div class="s-value">${statusBadge(client.connection_status)}</div><div class="s-sub">${client.last_event_at ? 'webhook אחרון ' + fmtAgo(client.last_event_at) : 'עדיין לא התקבל webhook'}</div></div>
        <div class="stat"><div class="s-label">ריצות היום</div><div class="s-value num">${dash.runs_today}</div><div class="s-sub">${dash.errors_today ? dash.errors_today + ' שגיאות היום' : 'ללא שגיאות היום'}</div></div>
        <div class="stat"><div class="s-label">זרימות פעילות כרגע</div><div class="s-value num">${dash.active_flows}</div><div class="s-sub">שיחות שהבוט באמצען</div></div>
      </div>
      <div class="dash-2col">
        <div class="card" style="margin:0"><h3>ריצות — 14 ימים אחרונים</h3>
          ${chartHtml}
          <div class="chart-legend"><span><span class="dotk" style="background:#5b6b4a"></span>ריצות (${dash.runs_30d} ב-30 ימים)</span><span><span class="dotk" style="background:#c0564d"></span>שגיאות (${dash.errors_30d})</span></div>
        </div>
        <div class="card" style="margin:0"><h3>פעולות מהירות</h3>
          <div class="quick-actions" style="flex-direction:column;align-items:stretch">
            <a class="btn" href="#/client/${client.id}/builder" style="justify-content:center">בוט חדש</a>
            <a class="btn secondary" href="#/client/${client.id}/automation" style="justify-content:center">אוטומציה חדשה</a>
            <a class="btn secondary" href="#/client/${client.id}/bots" style="justify-content:center">שליחת טסט לבוט</a>
            <a class="btn secondary" href="#/client/${client.id}/setup" style="justify-content:center">בדיקת חיבור</a>
          </div>
        </div>
      </div>
      <div class="dash-2col">
        <div class="card" style="margin:0"><h3>שגיאות אחרונות</h3>
          ${dash.recent_errors.length ? dash.recent_errors.map(e => `<div class="toplist-row"><span class="cell-sub num" style="white-space:nowrap">${fmtDateTime(e.received_at)}</span><span class="cell-sub">${esc(EVENT_LABELS[e.event_type] || e.event_type)}</span><span class="n" style="color:var(--red);font-weight:500;font-size:12px">${esc(e.details || '')}</span></div>`).join('') : '<div class="empty" style="padding:18px">אין שגיאות ב-30 הימים האחרונים</div>'}
        </div>
        <div class="card" style="margin:0"><h3>הבוטים והאוטומציות הפעילים ביותר</h3>
          ${dash.top_bots.length ? dash.top_bots.map(b => `<div class="toplist-row">✦ ${esc(b.name)}<span class="n">${b.runs}</span></div>`).join('') : '<div class="cell-sub" style="padding:6px 0">אין ריצות בוטים עדיין</div>'}
          ${dash.top_automations.length ? dash.top_automations.map(a => `<div class="toplist-row">⚡ ${esc(EVENT_LABELS[a.name] || a.name)}<span class="n">${a.runs}</span></div>`).join('') : '<div class="cell-sub" style="padding:6px 0">אין ריצות אוטומציות עדיין</div>'}
        </div>
      </div>`;
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
      <p class="page-sub">כל webhook ש-EasyBizy שלחה ומה המערכת עשתה איתו — סטטוסים בלבד, לצורך פתרון תקלות. המערכת לא שומרת ולא מציגה תוכן הודעות.</p>
      <div id="abody"></div>`);
    renderActivity(document.getElementById('abody'), null);
  }

  /* ---------------- bot builder ---------------- */
  async function viewBuilder(clientId, botId) {
    clearInterval(state.convoTimer);
    const { client } = await Api.getClient(clientId);
    const { templates } = await Api.listAllTemplates(clientId);
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
                <input class="input" id="wct" list="wct-names" dir="ltr" placeholder="— ללא —">
                <datalist id="wct-names">${templates.map(t => `<option value="${esc(t.name)}"></option>`).join('')}</datalist>
                <span class="hint">אם עברו 24 שעות מההודעה האחרונה של הלקוח, צעדי טקסט יוחלפו בתבנית הזו. הרשימה מוזנת מ״התבניות שלי״ במסך ההגדרה.</span></label>
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
        stepEl.querySelector('[data-a=edit]').onclick = () => stepModal(bot, p, () => renderSteps(), templates);
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
        }, templates);
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

    const previewSel = {};   // preview-only: step path -> tapped button value
    function bubbleFor(s, path) {
      const wait = (s.type === 'buttons' || s.type === 'question') ? '<div class="pv-wait">⏳ הבוט ממתין לתשובת הלקוח</div>' : '';
      if (s.type === 'buttons') {
        const sel = previewSel[path];
        const btns = (s.options || []).map(o => `<span class="bubble-btn pv-btn ${sel === o.value ? 'sel' : ''}" data-path="${path}" data-val="${esc(o.value)}">${esc(o.label)}</span>`).join('');
        let extra = '';
        if (sel) {
          const label = (s.options || []).find(o => o.value === sel)?.label || sel;
          const br = (s.branches || {})[sel] || [];
          extra = `<div class="bubble in">${esc(label)}<div class="meta">לקוח</div></div>`
            + (br.length ? br.slice(0, 3).map((b, j) => bubbleFor(b, `${path}.${j}`)).join('') : '<div class="pv-wait">אין צעדים בענף הזה עדיין</div>');
        }
        return `<div class="bubble out">${varPills(esc(s.text || ''))}${btns}<div class="meta">בוט</div></div>` + wait + extra;
      }
      if (s.type === 'link') return `<div class="bubble out">${varPills(esc(s.text || ''))}<span class="bubble-btn">⤴ ${esc(s.buttonLabel || s.url)}</span><div class="meta">בוט</div></div>`;
      if (s.type === 'template') return `<div class="bubble out"><div class="b-header">▤ ${esc(s.templateName)}</div>תבנית מאושרת<div class="meta">בוט</div></div>`;
      if (s.type === 'handoff') return `<div class="bubble out" style="background:#fff3cd">■ הבוט מושהה — השיחה עוברת לצוות</div>`;
      if (s.type === 'easybizy_action') return '';
      if (s.type === 'condition') return '';
      return `<div class="bubble out">${varPills(esc(s.text || s.caption || ''))}<div class="meta">בוט</div></div>` + wait;
    }
    function renderPreview() {
      $('#preview').innerHTML = bot.steps.slice(0, 6).map((s, i) => {
        const html = bubbleFor(s, String(i));
        return html ? `<div class="pv-group"><div class="pv-tag" data-goto="${i}" title="מעבר לצעד">הודעה ${i + 1}</div>${html}</div>` : '';
      }).join('') || '<div class="empty" style="color:var(--muted)">הוסיפו צעד לתצוגה</div>';
      $('#preview').querySelectorAll('.pv-btn').forEach(b => b.onclick = () => {
        previewSel[b.dataset.path] = previewSel[b.dataset.path] === b.dataset.val ? null : b.dataset.val;
        renderPreview();
      });
      $('#preview').querySelectorAll('.pv-tag').forEach(t => t.onclick = () => {
        const card = [...document.querySelectorAll('#steps .step')].find(el => el.dataset.path.split(':').length === 1 && +el.dataset.path.split(':')[0] === +t.dataset.goto);
        if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 900); }
      });
    }

    $('#add-step').onclick = () => stepModal(bot, null, (out) => { bot.steps.push(out); renderSteps(); }, templates);

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
    $('#send-test').onclick = () => {
      const m = modal(`
        <h3>שליחת טסט לנייד</h3>
        <p class="page-sub">ההודעות הראשונות של הבוט (עד נקודת ההמתנה לתשובה) יישלחו בוואטסאפ דרך חשבון EasyBizy של ${esc(client.name)}. שם פרטי יישלח כ״בדיקה״ ומשתני אירוע יישארו ריקים.</p>
        <label class="field"><span>מספר נייד לטסט</span><input class="input" dir="ltr" id="test-phone" inputmode="tel" placeholder="05X-XXXXXXX" value="${esc(client.test_phone || '')}"></label>
        <div class="modal-actions">
          <button class="btn" id="test-go">שליחה</button>
          <button class="btn secondary" id="test-cancel">ביטול</button>
        </div>`);
      m.querySelector('#test-cancel').onclick = () => m.remove();
      m.querySelector('#test-go').onclick = async (e) => {
        const phone = m.querySelector('#test-phone').value.trim();
        if (!phone) return toast('חסר מספר נייד');
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'שולח…';
        try {
          const body = {
            name: $('#bname').value.trim(),
            trigger_type: $('#trig').value,
            keywords: $('#kw').value.trim(),
            event: $('#ev').value,
            window_closed_template: $('#wct').value,
            steps: bot.steps,
          };
          if (!body.steps.length) { btn.disabled = false; btn.textContent = 'שליחה'; return toast('לבוט אין צעדים עדיין'); }
          if (!Api.demoMode && phone !== (client.test_phone || '')) { await Api.updateClient(client.id, { test_phone: phone }); client.test_phone = phone; }
          await Api.testBotSend(client.id, { phone, bot: body });
          m.remove();
          toast(Api.demoMode ? 'נשלח (מצב הדגמה)' : 'נשלח! ההודעות בדרך לנייד');
        } catch (err) {
          btn.disabled = false; btn.textContent = 'שליחה';
          toast('השליחה נכשלה: ' + (err.message || err));
        }
      };
    };
    renderSteps();
  }

  function stepModal(bot, p, onDone, templates = []) {
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
    const vars = botVars(bot);
    const chipsHint = `<span class="hint">הקשה על משתנה מוסיפה אותו במיקום הסמן:</span>`;

    const renderFields = () => {
      const t = typeSel.value;
      fields.innerHTML = {
        text: `<label class="field"><span>טקסט ההודעה</span><textarea class="input" id="f-text" rows="3">${esc(s.text || '')}</textarea>${chipsHint}${varChipsHTML(vars)}</label>`,
        buttons: `<label class="field"><span>טקסט ההודעה</span><textarea class="input" id="f-text" rows="2">${esc(s.text || '')}</textarea>${chipsHint}${varChipsHTML(vars)}</label>
          <div class="field"><span>אפשרויות ללקוח</span><div id="opts-list"></div>
            <button type="button" class="btn secondary small" id="opt-add">+ הוסף כפתור</button>
            <span class="hint" id="opts-mode"></span></div>
          <label class="field" id="btitle-wrap" style="display:none"><span>כותרת לרשימה</span><input class="input" id="f-buttonsTitle" value="${esc(s.buttonsTitle || '')}"></label>
          <span class="hint">אחרי השמירה, לכל כפתור ייפתח אזור ״אם נלחץ…״ עם צעדים משלו.</span>`,
        link: `<label class="field"><span>טקסט</span><textarea class="input" id="f-text" rows="2">${esc(s.text || '')}</textarea>${chipsHint}${varChipsHTML(vars)}</label>
          <label class="field"><span>כתובת</span><input class="input" dir="ltr" id="f-url" value="${esc(s.url || '')}"></label>
          <label class="field"><span>תווית כפתור</span><input class="input" id="f-buttonLabel" value="${esc(s.buttonLabel || '')}"></label>`,
        file: `<label class="field"><span>mediaId (מהעלאה ב-EasyBizy)</span><input class="input" dir="ltr" id="f-mediaId" value="${esc(s.mediaId || '')}"></label>
          <label class="field"><span>כיתוב</span><input class="input" id="f-caption" value="${esc(s.caption || '')}">${chipsHint}${varChipsHTML(vars)}</label>`,
        template: `<label class="field"><span>שם התבנית</span><input class="input" dir="ltr" id="f-templateName" list="st-tpl-names" value="${esc(s.templateName || '')}"><datalist id="st-tpl-names">${templates.map(t => `<option value="${esc(t.name)}"></option>`).join('')}</datalist></label>
          <label class="field"><span>פרמטרים (מופרדים בפסיק)</span><input class="input" id="f-params" value="${esc((s.params || []).join(', '))}">${chipsHint}${varChipsHTML(vars)}</label>`,
        question: `<label class="field"><span>השאלה</span><textarea class="input" id="f-text" rows="2">${esc(s.text || '')}</textarea>${chipsHint}${varChipsHTML(vars)}</label>
          <label class="field"><span>נשמר כמשתנה</span><input class="input" dir="ltr" id="f-saveAs" value="${esc(s.saveAs || '')}"></label>`,
        condition: `<label class="field"><span>שדה</span><input class="input" dir="ltr" id="f-field" value="${esc(s.field || '')}"></label>
          <label class="field"><span>תנאי</span><select class="input" id="f-op"><option value="contains">מכיל</option><option value="eq">שווה ל-</option><option value="exists">קיים</option></select></label>
          <label class="field"><span>ערך</span><input class="input" id="f-value" value="${esc(s.value || '')}"></label>`,
        easybizy_action: `<label class="field"><span>פעולה</span><select class="input" id="f-action"><option value="create_lead">יצירת ליד</option><option value="create_customer">יצירת לקוח</option><option value="add_activity">הוספת הערה ללקוח</option></select></label>
          <label class="field"><span>תוכן / הערה</span><textarea class="input" id="f-note" rows="2">${esc(s.note || '')}</textarea>${chipsHint}${varChipsHTML(vars)}</label>`,
        handoff: `<p class="page-sub">הבוט עוצר, והשיחה מסומנת כ״ממתין לצוות״ עד שמחזירים את הבוט.</p>`,
      }[t] || '';
      if (t === 'easybizy_action' && s.action) fields.querySelector('#f-action').value = s.action;
      if (t === 'condition' && s.op) fields.querySelector('#f-op').value = s.op;
      wireVarChips(fields);
      if (t === 'buttons') wireOptsEditor();

      function wireOptsEditor() {
        const list = fields.querySelector('#opts-list');
        const rows = () => [...list.querySelectorAll('.opt-row')];
        const refresh = () => {
          const n = rows().filter(r => r.querySelector('.opt-label').value.trim()).length || rows().length;
          fields.querySelector('#opt-add').style.display = rows().length >= 10 ? 'none' : '';
          fields.querySelector('#opts-mode').textContent = !n ? '' : n <= 3 ? `${n} אפשרויות — יישלחו ככפתורים` : `${n} אפשרויות — יישלחו כרשימה`;
          fields.querySelector('#btitle-wrap').style.display = n > 3 ? 'block' : 'none';
        };
        const addRow = (o = { label: '', value: '' }) => {
          const adv = o.value && o.value !== o.label;
          const row = document.createElement('div');
          row.className = 'opt-row';
          row.dataset.orig = o.value || '';
          row.innerHTML = `
            <input class="input opt-label" placeholder="תווית, למשל: כן" value="${esc(o.label || '')}">
            <div class="opt-tools">
              <button type="button" class="icon-btn opt-up" title="הזזה למעלה">↑</button>
              <button type="button" class="icon-btn opt-down" title="הזזה למטה">↓</button>
              <button type="button" class="icon-btn opt-adv ${adv ? 'on' : ''}" title="ערך פנימי (מתקדם)">Aa</button>
              <button type="button" class="icon-btn opt-del" title="מחיקה">✕</button>
            </div>
            <input class="input opt-value" dir="ltr" placeholder="ערך פנימי — ברירת מחדל: כמו התווית" value="${esc(adv ? o.value : '')}" style="display:${adv ? 'block' : 'none'}">`;
          row.querySelector('.opt-del').onclick = () => { row.remove(); refresh(); };
          row.querySelector('.opt-adv').onclick = (e) => {
            const inp = row.querySelector('.opt-value');
            const show = inp.style.display === 'none';
            inp.style.display = show ? 'block' : 'none';
            e.currentTarget.classList.toggle('on', show);
          };
          row.querySelector('.opt-up').onclick = () => { if (row.previousElementSibling) { list.insertBefore(row, row.previousElementSibling); refresh(); } };
          row.querySelector('.opt-down').onclick = () => { if (row.nextElementSibling) { list.insertBefore(row.nextElementSibling, row); refresh(); } };
          row.querySelector('.opt-label').addEventListener('input', refresh);
          list.appendChild(row);
        };
        (s.options || []).forEach(addRow);
        if (!(s.options || []).length) addRow();
        fields.querySelector('#opt-add').onclick = () => { addRow(); refresh(); };
        refresh();
      }
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
        out.options = [...fields.querySelectorAll('.opt-row')].map(r => {
          const label = r.querySelector('.opt-label').value.trim();
          const advVal = r.querySelector('.opt-value').value.trim();
          return { label, value: advVal || r.dataset.orig || label };
        }).filter(o => o.label).slice(0, 10);
        if (v('#f-buttonsTitle')) out.buttonsTitle = v('#f-buttonsTitle');
        if (out.options.length > 3 && !out.buttonsTitle) return toast('מעל 3 אפשרויות חובה כותרת לרשימה');
        if (!out.options.length) return toast('חסרים כפתורים');
        out.branches = s.branches || {};
        out.options.forEach(o => out.branches[o.value] = out.branches[o.value] || []);
        Object.keys(out.branches).forEach(k => { if (!out.options.some(o => o.value === k)) delete out.branches[k]; });
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
  /* ---------------- management board (demo, sample data only) ---------------- */
  const BOARD_TABS = [
    ['overview', 'מבט כללי'], ['campaigns', 'קמפיינים'], ['funnel', 'משפך'],
    ['attention', 'דורשים טיפול'], ['messages', 'הודעות אוטומטיות'], ['systems', 'מצב המערכות'],
  ];
  const ils = (n) => '\u20AA' + n.toLocaleString('he-IL');
  const TIP = {
    'לידים היום': 'פניות חדשות שנכנסו היום מכל הערוצים',
    'לידים החודש': 'סך הפניות החדשות מה-1 בחודש; האחוז משווה לחודש הקודם',
    'תורים שנקבעו השבוע': 'כמה לידים קבעו תור השבוע',
    'עסקאות נסגרו החודש': 'כמה מטופלים שילמו החודש',
    'הכנסה החודש': 'סך התשלומים שהתקבלו החודש ממטופלים ששויכו ללידים',
    'הוצאת פרסום החודש': 'סך ההוצאה על מודעות החודש; ההחזר = הכנסה חלקי הוצאה',
    'הוצאה': 'כמה שולם על פרסום הקמפיין בתקופה הנבחרת',
    'לידים': 'כמה פניות חדשות הגיעו מהקמפיין',
    'עלות לליד': 'הוצאת הפרסום חלקי מספר הלידים',
    'קבעו תור': 'כמה מהלידים קבעו תור בקליניקה',
    'הגיעו': 'כמה מבעלי התור הגיעו בפועל',
    'שילמו': 'כמה מטופלים שילמו על טיפול',
    'הכנסה': 'סך התשלומים ממטופלים ששויכו לקמפיין',
    'החזר על ההוצאה': 'הכנסה חלקי הוצאת הפרסום; על כל שקל שהושקע',
    'נשלחו': 'לכמה אנשי קשר נשלחה ההודעה',
    'ענו': 'כמה ענו להודעה, ואחוזם מכלל הנשלחו',
    'עלות שליחה': 'עלות שליחת התבנית בוואטסאפ לפי תעריפי מטא',
    'חדשים שלא קיבלו מענה': 'לידים חדשים שעוד לא נענתה להם הודעה ראשונה',
    'לחצו \u201Cלקבוע ייעוץ\u201D': 'לידים שלחצו על הכפתור ומחכים לתיאום',
    'בקשות שינוי תור': 'מטופלים שביקשו לשנות תור קיים',
    'פניות מהאתר בבדיקה ידנית': 'פניות מהטופס באתר שדורשות אימות לפני קליטה',
    'פעיל': 'רכיב שעובד כרגע כרגיל',
    'תצוגה מקדימה': 'רכיב בהרצת ניסיון לפני הפעלה מלאה',
    'לא נבנה': 'רכיב מתוכנן שעוד לא פותח',
  };
  const BOARD = {
    updated: 'עודכן לפני 12 דקות',
    kpis: [
      { label: 'לידים היום', value: '9', delta: '+2 מול אתמול', up: true },
      { label: 'לידים החודש', value: '168', delta: '+8% מול חודש קודם', up: true },
      { label: 'תורים שנקבעו השבוע', value: '14', delta: '+3 מול שבוע קודם', up: true },
      { label: 'עסקאות נסגרו החודש', value: '11', delta: '\u22121 מול חודש קודם', up: false },
      { label: 'הכנסה החודש', value: ils(86400), delta: '+15% מול חודש קודם', up: true },
      { label: 'הוצאת פרסום החודש', value: ils(12300), delta: 'החזר 7.0 על ההוצאה', up: true },
    ],
    leadDays: [6, 8, 5, 9, 7, 4, 10, 8, 6, 11, 9, 5, 7, 9],
    channels: [
      { name: 'מודעות מטא בוואטסאפ', n: 88, conv: '21%', cost: ils(118) },
      { name: 'אורגני / וואטסאפ ישיר', n: 52, conv: '29%', cost: 'ללא עלות' },
      { name: 'אתר', n: 14, conv: '29%', cost: ils(71) },
      { name: 'שיחה שלא נענתה', n: 9, conv: '33%', cost: 'ללא עלות' },
      { name: 'MedReviews', n: 5, conv: '20%', cost: ils(40) },
    ],
    campaigns: [
      { name: 'פייסטייט \u2013 נשים +35 \u2013 וידאו 1', channel: 'מטא \u00B7 וואטסאפ', spend: 4200, leads: 38, booked: 12, arrived: 9, paid: 6, revenue: 31200 },
      { name: 'מורפיאוס 8 \u2013 נשים \u2013 תמונה 2', channel: 'מטא \u00B7 וואטסאפ', spend: 3100, leads: 26, booked: 8, arrived: 6, paid: 4, revenue: 15800 },
      { name: 'פיסול אף \u2013 גברים \u2013 רילס 1', channel: 'מטא \u00B7 וואטסאפ', spend: 2700, leads: 19, booked: 5, arrived: 4, paid: 2, revenue: 24000 },
      { name: 'אתר \u2013 חיפוש ממומן (גוגל)', channel: 'גוגל \u00B7 אתר', spend: 1000, leads: 14, booked: 4, arrived: 3, paid: 2, revenue: 8400 },
      { name: 'בוסט אינסטגרם \u2013 קהל רחב', channel: 'מטא \u00B7 אינסטגרם', spend: 1300, leads: 11, booked: 2, arrived: 1, paid: 1, revenue: 3900 },
      { name: 'אורגני / לא משויך', channel: 'אורגני', spend: 0, leads: 60, booked: 15, arrived: 11, paid: 8, revenue: 12900 },
    ],
    attention: [
      { title: 'חדשים שלא קיבלו מענה', rows: [
        { name: 'נועה כ.', phone: '050-***-**34', ago: 'לפני 3 שעות', topic: 'פייסטייט' },
        { name: 'דן מ.', phone: '054-***-**81', ago: 'לפני 5 שעות', topic: 'בוטוקס' }] },
      { title: 'לחצו \u201Cלקבוע ייעוץ\u201D', rows: [
        { name: 'יעל ר.', phone: '052-***-**17', ago: 'לפני 40 דקות', topic: 'מורפיאוס 8' },
        { name: 'אבי ש.', phone: '050-***-**63', ago: 'לפני שעתיים', topic: 'השתלת שיער' },
        { name: 'מירי ל.', phone: '058-***-**29', ago: 'אתמול', topic: 'פייסטייט' }] },
      { title: 'בקשות שינוי תור', rows: [
        { name: 'רונית ב.', phone: '053-***-**92', ago: '\u201Cאפשר לדחות לשבוע הבא?\u201D', topic: 'תור ביום ה\u2033 10:30' }] },
      { title: 'פניות מהאתר בבדיקה ידנית', rows: [
        { name: 'כרמל ג.', phone: '054-***-**48', ago: 'שם לא תואם כרטיס קיים', topic: 'טופס האתר' },
        { name: 'סמדר א.', phone: '050-***-**15', ago: 'שני כרטיסים לאותו מספר', topic: 'טופס האתר' }] },
    ],
    templates: [
      { name: 'אישור פנייה מהאתר \u2013 נוסח 2', sent: 74, delivered: 72, answered: 31, booked: 9, unsub: 0, cost: 133 },
      { name: 'פולואפ לליד 24 שעות \u2013 עם שם', sent: 64, delivered: 61, answered: 18, booked: 7, unsub: 1, cost: 109 },
      { name: 'שיחה שלא נענתה', sent: 41, delivered: 40, answered: 12, booked: 3, unsub: 0, cost: 74 },
      { name: 'הנחיות לפני טיפול פייסטייט', sent: 22, delivered: 22, answered: 6, booked: null, unsub: 0, cost: 40 },
      { name: 'נוסח ג \u2013 תור שבוטל', sent: 9, delivered: 9, answered: 4, booked: 2, unsub: 0, cost: 16 },
    ],
    systems: [
      { name: 'קליטת אירועים מאיזיביזי (webhook)', status: 'פעיל', meta: 'אירוע אחרון לפני 2 דקות' },
      { name: 'שיוך לידים לקמפייני מטא', status: 'פעיל', meta: 'עודכן לפני 14 דקות' },
      { name: 'חשבון וואטסאפ \u2013 איכות GREEN', status: 'פעיל', meta: 'נבדק לפני שעה' },
      { name: 'תוסף האתר 2.5.4', status: 'פעיל', meta: 'פנייה אחרונה לפני 4 שעות' },
      { name: 'שיחה שלא נענתה (Twilio)', status: 'פעיל', meta: 'אתמול 18:42' },
      { name: 'MedReviews', status: 'פעיל', meta: 'לפני יומיים' },
      { name: 'הנחיות לפני פייסטייט', status: 'פעיל', meta: 'נשלח היום 10:00' },
      { name: 'שיוך כפתור וואטסאפ באתר', status: 'תצוגה מקדימה', meta: 'אירוע אחרון לפני שעה' },
      { name: 'עדכון סטטוסים אוטומטי', status: 'תצוגה מקדימה', meta: 'רץ לפני 25 דקות' },
      { name: 'הודעות לפי סטטוס', status: 'לא נבנה', meta: '\u2014' },
    ],
    sysErrors: 'שגיאת שליחה אחת ב-7 הימים האחרונים (whatsapp-messages.failed, אתמול)',
  };
  BOARD.channelFunnels = [
    { name: 'מודעות מטא בוואטסאפ', leads: 88, booked: 25, arrived: 18, paid: 12, spend: 11300, delta: '+9% לידים', up: true },
    { name: 'אורגני / וואטסאפ ישיר', leads: 52, booked: 14, arrived: 10, paid: 7, spend: 0, delta: '+6% לידים', up: true },
    { name: 'אתר', leads: 14, booked: 4, arrived: 3, paid: 2, spend: 1000, delta: 'ללא שינוי', up: true },
    { name: 'שיחה שלא נענתה', leads: 9, booked: 2, arrived: 2, paid: 1, spend: 0, delta: '+2 לידים', up: true },
    { name: 'MedReviews', leads: 5, booked: 1, arrived: 1, paid: 1, spend: 200, delta: '−1 ליד', up: false },
  ];
  const BOARD_PERIODS = [['day', 'היום'], ['week', 'השבוע'], ['month', 'החודש'], ['prevmonth', 'חודש קודם'], ['q90', '90 ימים'], ['custom', 'טווח תאריכים']];
  const chan = (meta, organic, site, call, medrev) => [
    { name: 'מודעות מטא בוואטסאפ', n: meta, conv: '21%', cost: ils(118) },
    { name: 'אורגני / וואטסאפ ישיר', n: organic, conv: '29%', cost: 'ללא עלות' },
    { name: 'אתר', n: site, conv: '29%', cost: ils(71) },
    { name: 'שיחה שלא נענתה', n: call, conv: '33%', cost: 'ללא עלות' },
    { name: 'MedReviews', n: medrev, conv: '20%', cost: ils(40) },
  ];
  BOARD.periods = {
    day: { chartTitle: 'לידים \u2014 היום לפי שעות', leadDays: [0, 1, 0, 2, 1, 3, 2, 4, 3, 2, 5, 3, 4, 2], channels: chan(6, 4, 1, 1, 1),
      kpis: [
        { label: 'לידים היום', value: '9', delta: '+2 מול אתמול', up: true },
        { label: 'תורים שנקבעו היום', value: '3', delta: '+1 מול אתמול', up: true },
        { label: 'עסקאות נסגרו היום', value: '1', delta: 'כמו אתמול', up: true },
        { label: 'הכנסה היום', value: ils(4200), delta: '+12% מול אתמול', up: true },
        { label: 'הוצאת פרסום היום', value: ils(410), delta: 'החזר 10.2 על ההוצאה', up: true },
        { label: 'פניות ממתינות למענה', value: '2', delta: 'הישנות מלפני 3 שעות', up: false },
      ] },
    week: { chartTitle: 'לידים \u2014 7 ימים אחרונים', leadDays: [8, 6, 11, 9, 5, 7, 9], channels: chan(48, 29, 8, 5, 3),
      kpis: [
        { label: 'לידים השבוע', value: '55', delta: '+6% מול שבוע קודם', up: true },
        { label: 'תורים שנקבעו השבוע', value: '14', delta: '+3 מול שבוע קודם', up: true },
        { label: 'עסקאות נסגרו השבוע', value: '4', delta: '\u22121 מול שבוע קודם', up: false },
        { label: 'הכנסה השבוע', value: ils(21300), delta: '+9% מול שבוע קודם', up: true },
        { label: 'הוצאת פרסום השבוע', value: ils(2950), delta: 'החזר 7.2 על ההוצאה', up: true },
        { label: 'פניות ממתינות למענה', value: '2', delta: 'הישנות מלפני 3 שעות', up: false },
      ] },
    month: { chartTitle: 'לידים \u2014 14 ימים אחרונים', get leadDays() { return BOARD.leadDays; }, get channels() { return BOARD.channels; }, get kpis() { return BOARD.kpis; } },
    prevmonth: { chartTitle: 'לידים \u2014 החודש הקודם', leadDays: [5, 7, 4, 8, 6, 9, 7, 5, 8, 6, 4, 7, 8, 6], channels: chan(79, 47, 12, 8, 4),
      kpis: [
        { label: 'לידים בחודש הקודם', value: '154', delta: 'החודש: 168 (+8%)', up: true },
        { label: 'תורים שנקבעו', value: '39', delta: 'מול 46 החודש', up: false },
        { label: 'עסקאות נסגרו', value: '12', delta: 'מול 11 החודש', up: true },
        { label: 'הכנסה', value: ils(75100), delta: 'מול ' + ils(86400) + ' החודש', up: true },
        { label: 'הוצאת פרסום', value: ils(11900), delta: 'החזר 6.3 על ההוצאה', up: true },
        { label: 'עלות לליד', value: ils(126), delta: 'מול ' + ils(118) + ' החודש', up: true },
      ] },
    q90: { chartTitle: 'לידים \u2014 12 שבועות אחרונים', leadDays: [32, 38, 35, 41, 39, 44, 47, 43, 50, 46, 52, 49], channels: chan(251, 148, 39, 26, 14),
      kpis: [
        { label: 'לידים ב-90 ימים', value: '478', delta: '+11% מול 90 הקודמים', up: true },
        { label: 'תורים שנקבעו', value: '131', delta: '+9%', up: true },
        { label: 'עסקאות נסגרו', value: '34', delta: '+6%', up: true },
        { label: 'הכנסה ב-90 ימים', value: ils(241800), delta: '+13%', up: true },
        { label: 'הוצאת פרסום ב-90 ימים', value: ils(35400), delta: 'החזר 6.8 על ההוצאה', up: true },
        { label: 'עלות לליד ממוצעת', value: ils(121), delta: '\u22124% שיפור', up: true },
      ] },
    custom: { chartTitle: 'לידים \u2014 בטווח שנבחר', leadDays: [4, 6, 3, 7, 5, 8, 6, 4, 5, 7, 3, 6, 5, 4], channels: chan(34, 21, 6, 4, 2),
      kpis: [
        { label: 'לידים בטווח', value: '67', delta: 'נתוני דמו', up: true },
        { label: 'תורים שנקבעו', value: '17', delta: 'נתוני דמו', up: true },
        { label: 'עסקאות נסגרו', value: '5', delta: 'נתוני דמו', up: true },
        { label: 'הכנסה בטווח', value: ils(26900), delta: 'נתוני דמו', up: true },
        { label: 'הוצאת פרסום בטווח', value: ils(3600), delta: 'החזר 7.5 על ההוצאה', up: true },
        { label: 'עלות לליד', value: ils(105), delta: 'נתוני דמו', up: true },
      ] },
  };

  function viewBoard(section = 'overview') {
    clearInterval(state.convoTimer);
    shell('board', `
      <div class="page-head"><h1>דשבורד ניהול</h1><span class="badge yellow">נתוני דמו</span></div>
      <div class="board-tabs">${BOARD_TABS.map(([k, l]) => `<a class="board-tab ${section === k ? 'active' : ''}" href="#/board/${k}">${l}</a>`).join('')}</div>
      <div class="cell-sub" style="margin:2px 0 14px">${BOARD.updated} \u00B7 הדגמה בלבד \u2014 נתונים לצורך הצגה בלבד, אין חיבור לנתוני הקליניקה</div>
      <div id="board-body"></div>`, null, 'clinic');
    const body = document.getElementById('board-body');
    ({ overview: boardOverview, campaigns: boardCampaigns, funnel: boardFunnel, attention: boardAttention, messages: boardMessages, systems: boardSystems, mapping: boardMapping, fieldmap: boardFieldMap, workplan: boardWorkPlan }[section] || boardOverview)(body);
  }

  function boardOverview(el) {
    const pk = state.boardPeriod || 'month';
    const P = BOARD.periods[pk] || BOARD.periods.month;
    const chartHtml = c2chart(P.leadDays, {
      labels: P.leadDays.map((_, i) => (i % 2 === 0 ? (pk === 'day' ? `${8 + i}:00` : String(i + 1)) : '')),
      tip: (i) => `${P.leadDays[i]} לידים`,
    });
    const pal = ['var(--pal0)', 'var(--pal1)', 'var(--pal2)', 'var(--pal3)', 'var(--pal4)'];
    const chanTot = P.channels.reduce((a, ch) => a + ch.n, 0);
    let _acc = 0;
    const donutSegs = P.channels.map((ch, i) => { const f = _acc / chanTot * 360; _acc += ch.n; return `${pal[i % 5]} ${f}deg ${_acc / chanTot * 360}deg`; }).join(', ');
    const donutHtml = `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${donutSegs})"><div class="hole"><div><b class="num">${chanTot}</b><small>לידים</small></div></div></div><div class="donut-legend">${P.channels.map((ch, i) => `<div class="dl-row"><span class="dotk" style="background:${pal[i % 5]}"></span><span class="dl-name">${ch.name}</span><b class="num">${ch.n} · ${Math.round(ch.n / chanTot * 100)}%</b></div>`).join('')}</div></div>`;
    const rangeNote = pk === 'custom' ? `<span class="range-box"><input type="date" id="rng-from" value="2026-11-01"> \u05E2\u05D3 <input type="date" id="rng-to" value="2026-11-24"></span>` : '';
    el.innerHTML = `
      <div class="board-tabs" style="margin-top:0;flex-wrap:wrap">
        ${BOARD_PERIODS.map(([k, l]) => `<button class="board-tab ${pk === k ? 'active' : ''}" data-period="${k}">${l}</button>`).join('')}
        ${rangeNote}
      </div>
      <div class="dash-grid">
        ${P.kpis.map((k, i) => `<div class="stat kpi has-tip" data-tip="${TIP[k.label] || ''}" tabindex="0" style="--ac:${['var(--ac-blue)', 'var(--ac-blue)', 'var(--ac-orange)', 'var(--ac-green)', 'var(--ac-purple)', 'var(--ac-red)'][i % 6]}"><div class="s-label">${k.label}<span class="info-i">i</span></div><div class="s-value num">${k.value}</div><div class="s-sub" style="color:${k.up ? 'var(--mint-ink)' : 'var(--red)'}">${k.delta}</div><span class="kpi-chip ${k.up ? 'ok' : 'bad'}">${k.up ? 'מגמה חיובית' : 'דורש טיפול'}</span></div>`).join('')}
      </div>
      <div class="dash-2col">
        <div class="card" style="margin:0"><h3>${P.chartTitle}</h3>
          <div class="has-tip" data-tip="מספר הלידים שנכנסו בכל יחידת זמן בתקופה הנבחרת" tabindex="0">${chartHtml}</div>
        </div>
        <div class="card has-tip" style="margin:0" data-tip="פירוט הלידים לפי ערוץ בתקופה הנבחרת; המרה = אחוז הלידים שקבעו תור, ועלות להמרה = הוצאת הערוץ חלקי קובעי התור" tabindex="0"><h3>לידים לפי ערוץ</h3>
          ${donutHtml}
          <div class="chan-grid">${P.channels.map(ch => {
            const cv = parseInt(ch.conv);
            const cc = cv >= 28 ? 'var(--ac-green)' : cv >= 21 ? 'var(--ac-orange)' : 'var(--ac-red)';
            return `<div class="chan-tile" style="--ac:${cc}">
              <div class="chan-name">${ch.name}</div>
              <div class="chan-n num">${ch.n}<span class="chan-nl">לידים</span></div>
              <div class="chan-stats">
                <div class="chan-stat"><b class="num" style="color:${cc}">${ch.conv}</b><span>אחוז המרה</span></div>
                <div class="chan-stat"><b class="num">${ch.cost}</b><span>עלות להמרה</span></div>
              </div>
            </div>`;
          }).join('')}</div>
        </div>
      </div>
      <div class="alert-strip"><span class="as-ico">⚠</span><span><b>שים לב:</b> חלק מהמספרים חלקיים — סטטוסי לידים מתעדכנים כרגע ידנית, ו-187 מודעות ממתינות למיפוי שמות. אחרי הפעלת העדכון האוטומטי והשלמת המיפוי הדוחות מלאים.</span></div>`;
    el.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { state.boardPeriod = b.dataset.period; boardOverview(el); });
    const rf = document.getElementById('rng-from'), rt = document.getElementById('rng-to');
    if (rf) rf.onchange = rt.onchange = () => boardOverview(el);
  }

  const HB_LAYOUTS = [['1', 'שם מלא + שארית דקה'], ['2', 'מספרים בפנים'], ['3', 'כרטיסי קמפיין'], ['4', 'אורך לפי נפח']];

  function hbRender(layout) {
    const cs = BOARD.campaigns;
    const legend = `<div class="chart-legend"><span><span class="dotk" style="background:var(--hb-paid)"></span>שילמו</span><span><span class="dotk" style="background:var(--hb-arr)"></span>הגיעו</span><span><span class="dotk" style="background:var(--hb-book)"></span>קבעו תור</span><span><span class="dotk" style="background:var(--hb-ghost-line)"></span>לא קבעו תור</span></div>`;
    const segsT = (c) => {
      let o = '';
      [[c.paid, 'var(--hb-paid)'], [c.arrived - c.paid, 'var(--hb-arr)'], [c.booked - c.arrived, 'var(--hb-book)']].forEach(([n, col]) => {
        if (n > 0) o += `<span class="hb-seg" style="width:${n / c.leads * 100}%;background:${col}"></span>`;
      });
      if (c.leads - c.booked > 0) o += `<span class="hb-seg hb-thin" style="width:${(c.leads - c.booked) / c.leads * 100}%"></span>`;
      return o;
    };
    const valsLine = (c) => `<div class="hb1vals"><span class="v" style="color:var(--hbt-paid)">${c.paid}</span><span class="l">שילמו</span> · <span class="v" style="color:var(--hbt-arr)">${c.arrived}</span><span class="l">הגיעו</span> · <span class="v" style="color:var(--hbt-book)">${c.booked}</span><span class="l">קבעו</span> · <span class="v" style="color:var(--muted)">${c.leads - c.booked}</span><span class="l">לא קבעו</span></div>`;
    if (layout === '2') {
      const seg2 = (n, leads, col, tc) => n <= 0 ? '' : `<span class="hb-seg hb2seg" style="width:${n / leads * 100}%;background:${col};color:${tc}">${n / leads * 100 >= 7 ? `<i>${n}</i>` : ''}</span>`;
      return cs.map(c => `<div class="hb2r">
        <span class="hb2nm">${c.name}</span>
        <span class="hb2bar">${seg2(c.paid, c.leads, 'var(--hb-paid)', '#fff')}${seg2(c.arrived - c.paid, c.leads, 'var(--hb-arr)', '#14532d')}${seg2(c.booked - c.arrived, c.leads, 'var(--hb-book)', '#713f12')}<span class="hb-seg hb2ghost" style="width:${(c.leads - c.booked) / c.leads * 100}%"></span></span>
        <b class="num hb2conv">${Math.round(c.paid / c.leads * 100)}%</b>
      </div>`).join('') + legend;
    }
    if (layout === '3') {
      return `<div class="hb3grid">` + cs.map(c => `<div class="hb3c">
        <div class="hb3nm">${c.name}</div>
        <div class="hb3top"><b class="num">${c.leads}</b><span class="hb3l">לידים</span><span class="num hb3conv">${Math.round(c.paid / c.leads * 100)}% שילמו</span></div>
        <div class="hb3bar">${segsT(c)}</div>
        <div class="hb3chips"><span style="color:var(--hbt-book)">קבעו ${c.booked}</span><span style="color:var(--hbt-arr)">הגיעו ${c.arrived}</span><span style="color:var(--hbt-paid)">שילמו ${c.paid}</span></div>
      </div>`).join('') + `</div>`;
    }
    if (layout === '4') {
      const mx = Math.max(...cs.map(c => c.leads));
      return cs.map(c => `<div class="hb1r">
        <div class="hb1top"><span class="hb1nm">${c.name}</span><b class="num hb1tot">${c.leads}</b></div>
        <div class="hb4wrap"><span class="hb4bar" style="width:${c.leads / mx * 100}%">${segsT(c)}</span></div>
      </div>`).join('') + legend;
    }
    return cs.map(c => `<div class="hb1r">
      <div class="hb1top"><span class="hb1nm">${c.name}</span><b class="num hb1tot">${c.leads} לידים</b></div>
      <div class="hb1bar">${segsT(c)}</div>
      ${valsLine(c)}
    </div>`).join('') + legend;
  }

  function boardCampaigns(el) {
    const sum = (f) => BOARD.campaigns.reduce((a, c) => a + c[f], 0);
    const totals = { spend: sum('spend'), leads: sum('leads'), booked: sum('booked'), paid: sum('paid'), revenue: sum('revenue') };
    const counter = (label, value, color) => `<div class="att-counter has-tip" data-tip="${TIP[label] || ''}" tabindex="0" style="--ac:${color}">
      <div class="ac-num num">${value}</div><div class="ac-label">${label}<span class="info-i">i</span></div></div>`;
    const tile = (label, value, color) => `<div class="msg-tile has-tip" data-tip="${TIP[label] || ''}" tabindex="0" style="--ac:${color}">
      <div class="msg-num num" style="font-size:20px">${value}</div><div class="msg-label">${label}<span class="info-i">i</span></div></div>`;
    const CD = [['+12% לידים', true], ['+4% לידים', true], ['+18% לידים', true], ['−5% לידים', false], ['+2 לידים', true], ['+7% לידים', true]];
    const sel = Math.min(state.campSel == null ? 0 : state.campSel, BOARD.campaigns.length - 1);
    const c = BOARD.campaigns[sel];
    const flKey = 'wa-funnel-default';
    const urlFl = new URLSearchParams(location.search).get('fl');
    const curFl = urlFl || state.campFunnelLayout || localStorage.getItem(flKey) || '1';
    const flSetDef = localStorage.getItem('wa-funnel-setdef') === '1';
    const cpl = c.spend && c.leads ? ils(Math.round(c.spend / c.leads)) : '—';
    const cpp = c.spend && c.paid ? ils(Math.round(c.spend / c.paid)) : (c.paid ? 'ללא עלות' : '—');
    const roas = c.spend ? (c.revenue / c.spend).toFixed(1) : '—';
    const trend = Array.from({ length: 14 }, (_, i) => Math.max(0, Math.round(c.leads / 14 * (0.55 + ((i * 7 + sel * 3 + 2) % 5) * 0.22))));
    const stages = [['לידים', c.leads], ['קבעו תור', c.booked], ['הגיעו', c.arrived], ['שילמו', c.paid]];
    const rowHtml = (cc, i) => {
      const rcpl = cc.spend && cc.leads ? ils(Math.round(cc.spend / cc.leads)) : '—';
      const rroas = cc.spend ? '×' + (cc.revenue / cc.spend).toFixed(1) : '—';
      return `<tr data-rowcamp="${i}" style="cursor:pointer${i === sel ? ';background:var(--gray-soft)' : ''}">
        <td data-h="קמפיין"><b>${cc.name}</b></td>
        <td data-h="ערוץ"><span class="badge blue">${cc.channel}</span></td>
        <td data-h="הוצאה" class="num">${cc.spend ? ils(cc.spend) : '—'}</td>
        <td data-h="לידים" class="num">${cc.leads}</td>
        <td data-h="עלות לליד" class="num">${rcpl}</td>
        <td data-h="קבעו תור" class="num">${cc.booked}</td>
        <td data-h="הגיעו" class="num">${cc.arrived}</td>
        <td data-h="שילמו" class="num">${cc.paid}</td>
        <td data-h="הכנסה" class="num">${ils(cc.revenue)}</td>
        <td data-h="החזר" class="num">${rroas}</td>
      </tr>`;
    };
    el.innerHTML = `
      <div class="board-tabs" style="margin-top:0">
        <span class="board-tab active">החודש</span><span class="board-tab" style="opacity:.55">7 ימים</span><span class="board-tab" style="opacity:.55">90 ימים</span>
        <span class="board-tab" style="opacity:.55">ערוץ: הכל</span><span class="board-tab" style="opacity:.55">טיפול: הכל</span>
      </div>
      <div class="att-counters c6">
        ${counter('הוצאה', ils(totals.spend), 'var(--ac-red)')}
        ${counter('לידים', totals.leads, 'var(--ac-blue)')}
        ${counter('קבעו תור', totals.booked, 'var(--ac-orange)')}
        ${counter('שילמו', totals.paid, 'var(--ac-green)')}
        ${counter('הכנסה', ils(totals.revenue), 'var(--ac-purple)')}
        ${counter('החזר על ההוצאה', '×' + (totals.revenue / totals.spend).toFixed(1), 'var(--green)')}
      </div>
      <div class="card" style="margin:0 0 12px"><h3>השוואת קמפיינים</h3>
        <div class="tbl-wrap"><table class="tbl tbl-rows">
          <thead><tr><th>קמפיין</th><th>ערוץ</th><th>הוצאה</th><th>לידים</th><th>עלות לליד</th><th>קבעו תור</th><th>הגיעו</th><th>שילמו</th><th>הכנסה</th><th>החזר</th></tr></thead>
          <tbody>${BOARD.campaigns.map(rowHtml).join('')}</tbody>
        </table></div>
        <div class="cell-sub" style="margin-top:8px">לחיצה על שורה פותחת זום מלא על הקמפיין למטה.</div>
      </div>
      <div class="card" style="margin:0"><h3>זום על קמפיין</h3>
        <div class="board-tabs" style="flex-wrap:wrap;margin-bottom:12px">${BOARD.campaigns.map((cc, i) => `<button class="board-tab ${i === sel ? 'active' : ''}" data-csel="${i}">${cc.name}</button>`).join('')}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><h4 style="margin:0">${c.name}</h4><span class="badge blue">${c.channel}</span><span class="cell-sub" style="color:${CD[sel][1] ? 'var(--mint-ink)' : 'var(--red)'}">${CD[sel][0]} מול חודש קודם</span></div>
        <div class="msg-stats c4" style="margin:2px 0 8px">
          ${tile('הוצאה', ils(c.spend), 'var(--ac-red)')}
          ${tile('לידים', c.leads, 'var(--ac-blue)')}
          ${tile('עלות לליד', cpl, 'var(--ac-cyan)')}
          ${tile('קבעו תור', c.booked, 'var(--ac-orange)')}
          ${tile('הגיעו', c.arrived, 'var(--ac-olive)')}
          ${tile('שילמו', c.paid, 'var(--ac-green)')}
          ${tile('הכנסה', ils(c.revenue), 'var(--ac-purple)')}
          ${tile('החזר על ההוצאה', roas === '—' ? '—' : '×' + roas, 'var(--green)')}
        </div>
        <div class="cell-sub" style="margin:0 0 12px">עלות למטופל משלם: <b>${cpp}</b></div>
        <div class="dash-2col">
          <div>
            <h4 style="margin:0 0 8px">המשפך של הקמפיין</h4>
            <div class="board-tabs hb-tabs" style="flex-wrap:wrap">${FN_LAYOUTS.map(([k, l]) => `<button class="board-tab ${curFl === k ? 'active' : ''}" data-fl2="${k}"><span class="num">${k}</span> · ${l}</button>`).join('')}
              <label class="fn-def"><input type="checkbox" id="fl2-def" ${flSetDef ? 'checked' : ''}> קבע כברירת מחדל</label></div>
            ${fnRender(curFl, c, 'camp')}
            ${fnChips(stages)}
          </div>
          <div>
            <h4 style="margin:0 0 8px">לידים — 14 ימים אחרונים</h4>
            ${c2chart(trend, { labels: trend.map((_, i) => (i % 2 === 0 ? String(i + 1) : '')), tip: (i) => `${trend[i]} לידים` })}
          </div>
        </div>
      </div>`;
    el.querySelectorAll('[data-csel]').forEach(b => b.onclick = () => { state.campSel = +b.dataset.csel; boardCampaigns(el); });
    el.querySelectorAll('[data-rowcamp]').forEach(r => r.onclick = () => { state.campSel = +r.dataset.rowcamp; boardCampaigns(el); });
    const flBox = el.querySelector('#fl2-def');
    flBox.onchange = () => {
      localStorage.setItem('wa-funnel-setdef', flBox.checked ? '1' : '0');
      if (flBox.checked) localStorage.setItem(flKey, state.campFunnelLayout || curFl);
    };
    el.querySelectorAll('[data-fl2]').forEach(b => b.onclick = () => {
      state.campFunnelLayout = b.dataset.fl2;
      if (flBox.checked) localStorage.setItem(flKey, b.dataset.fl2);
      boardCampaigns(el);
    });
  }

  const FCOL = [['var(--fc0a)', 'var(--fc0b)'], ['var(--fc1a)', 'var(--fc1b)'], ['var(--fc2a)', 'var(--fc2b)'], ['var(--fc3a)', 'var(--fc3b)']];
  const FN_LAYOUTS = [['1', 'משפך קלאסי'], ['2', 'חצים'], ['3', 'סרגלים'], ['4', 'טבעות'], ['5', 'כרטיסים'], ['6', 'זרימה']];

  function fnChips(stages) {
    const total = Math.round(stages[3][1] / stages[0][1] * 100);
    let worst = 1, best = 1;
    for (let i = 1; i < 4; i++) {
      const p = stages[i][1] / stages[i - 1][1];
      if (p < stages[worst][1] / stages[worst - 1][1]) worst = i;
      if (p > stages[best][1] / stages[best - 1][1]) best = i;
    }
    const pc = (i) => Math.round(stages[i][1] / stages[i - 1][1] * 100) + '%';
    return `<div class="chips"><span class="chip">המרה מקצה לקצה <b class="num">${total}%</b></span><span class="chip">הנשירה הגדולה: ${stages[worst - 1][0]} → ${stages[worst][0]} <b class="num">${pc(worst)}</b></span><span class="chip">המעבר החזק: ${stages[best - 1][0]} → ${stages[best][0]} <b class="num">${pc(best)}</b></span></div>`;
  }

  function fnRender(layout, c, ci) {
    const stages = [['לידים', c.leads], ['קבעו תור', c.booked], ['הגיעו', c.arrived], ['שילמו', c.paid]];
    const N = 4, uid = `fn${layout}${ci}`;
    const conv = (i) => Math.round(stages[i][1] / stages[i - 1][1] * 100) + '%';
    const lost = (i) => stages[i - 1][1] - stages[i][1];
    const grads = (dir) => FCOL.map((g, i) => `<linearGradient id="${uid}${dir}${i}" x1="0" y1="0" x2="${dir === 'h' ? 1 : 0}" y2="${dir === 'h' ? 0 : 1}"><stop offset="0" style="stop-color:${g[0]}"/><stop offset="1" style="stop-color:${g[1]}"/></linearGradient>`).join('');
    const mob = window.innerWidth < 640;

    if (layout === '1') {
      const W = mob ? 480 : 900, H = 340, cx = mob ? 165 : 290, top = mob ? 270 : 480, bot = mob ? 100 : 150, gap = 8, sh = (H - gap * (N - 1)) / N, step = (top - bot) / N;
      const px = mob ? 320 : 610, pw = mob ? 145 : 180;
      let o = `<svg viewBox="0 0 ${W} ${H}"><defs>${grads('v')}</defs>`;
      stages.forEach(([nm, v], i) => {
        const y = i * (sh + gap), wt = top - i * step, wb = top - (i + 1) * step;
        o += `<polygon fill="url(#${uid}v${i})" points="${cx - wt / 2},${y} ${cx + wt / 2},${y} ${cx + wb / 2},${y + sh} ${cx - wb / 2},${y + sh}"/>
        <polygon fill="rgba(255,255,255,.12)" points="${cx - wt / 2},${y} ${cx + wt / 2},${y} ${cx + (wt + wb) / 4},${y + sh / 2} ${cx - (wt + wb) / 4},${y + sh / 2}"/>
        <text x="${cx}" y="${y + sh / 2 - 2}" text-anchor="middle" fill="#fff" fill-opacity=".9" font-size="${mob ? 13 : 15}" font-weight="700">${nm}</text>
        <text x="${cx}" y="${y + sh / 2 + 24}" text-anchor="middle" fill="#fff" font-size="${mob ? 18 : 22}" font-weight="700">${v}</text>`;
        if (i) {
          const ex = cx + wt / 2 + 10, py = y - gap / 2;
          o += `<line x1="${ex}" y1="${py}" x2="${px - 6}" y2="${py}" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="3 5"/><circle cx="${ex}" cy="${py}" r="3" class="ft"/>
          <rect x="${px}" y="${py - 17}" width="${pw}" height="34" rx="17" class="fchip"/>
          <text x="${px + (mob ? 14 : 18)}" y="${py + 6}" class="ftg" font-size="${mob ? 15 : 17}" font-weight="800">${conv(i)}</text>
          <text x="${px + (mob ? 60 : 78)}" y="${py + 5}" class="ftr" font-size="${mob ? 12 : 14}">−${lost(i)} ירדו</text>`;
        }
      });
      return o + '</svg>';
    }
    if (layout === '2') {
      const hs = [140, 118, 100, 86];
      return `<div class="chev">` + stages.map(([nm, v], i) => `
        <div class="c"><div class="shape" style="height:${hs[i]}px;background:linear-gradient(135deg,${FCOL[i][0]},${FCOL[i][1]})">${nm}</div>
        <div class="meta"><div class="v num">${v}</div><div class="cv">${i ? `<em class="num">${conv(i)}</em> מהשלב הקודם` : 'נקודת פתיחה'}</div></div></div>`).join('') + `</div>`;
    }
    if (layout === '3') {
      return `<div class="bars">` + stages.map(([nm, v], i) => {
        const w = Math.max(12, Math.round(100 * Math.pow(v / stages[0][1], .4)));
        return `<div class="bar-row"><div class="lab"><b>${nm}</b><span class="num">${v}</span></div>
        <div class="track"><div class="fill" style="width:${w}%;color:${FCOL[i][1]};background:linear-gradient(90deg,${FCOL[i][1]},${FCOL[i][0]} 50%,${FCOL[i][1]})"></div></div>
        <div class="cv">${i ? `<b class="num">${conv(i)}</b><i class="num">−${lost(i)} ירדו</i>` : '<b>100%</b><i>פתיחה</i>'}</div></div>`;
      }).join('') + `</div>`;
    }
    if (layout === '4') {
      const W = mob ? 480 : 900, H = mob ? 290 : 420, cx = mob ? 130 : 250, bottom = mob ? 278 : 405, R = mob ? 120 : 190, dr = mob ? 30 : 42;
      const lx = mob ? 280 : 560, tx = mob ? 292 : 575, cvx = mob ? 428 : 760;
      const rs = stages.map((_, i) => R - i * dr);
      let o = `<svg viewBox="0 0 ${W} ${H}"><defs>${grads('v')}</defs>`;
      stages.forEach((_, i) => { o += `<circle cx="${cx}" cy="${bottom - rs[i]}" r="${rs[i]}" fill="url(#${uid}v${i})" stroke="var(--card)" stroke-width="3"/>`; });
      stages.forEach(([nm, v], i) => {
        const t = bottom - 2 * rs[i], nt = i < N - 1 ? bottom - 2 * rs[i + 1] : bottom - rs[i] - 14;
        const y = i < N - 1 ? (t + nt) / 2 : bottom - rs[i];
        o += `<circle cx="${cx}" cy="${y}" r="3.5" fill="#fff"/>
        <line x1="${cx}" y1="${y}" x2="${lx}" y2="${y}" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="3 5"/>
        <text x="${tx}" y="${y - 2}" font-size="${mob ? 12.5 : 14}" font-weight="700" style="fill:${FCOL[i][0]}">${nm}</text>
        <text x="${tx}" y="${y + (mob ? 17 : 20)}" class="ft" font-size="${mob ? 15 : 19}" font-weight="700">${v}</text>
        <text x="${cvx}" y="${y + (mob ? 18 : 21)}" class="ftg" font-size="${mob ? 14 : 17}" font-weight="800">${i ? conv(i) : ''}</text>`;
      });
      return o + '</svg>';
    }
    if (layout === '5') {
      return `<div class="fcards">` + stages.map(([nm, v], i) => {
        const w = 100 - i * 10, pp = i ? Math.max(stages[i][1] / stages[i - 1][1] * 100, 2) : 100;
        return `<div class="fcard" style="width:${w}%;--c:${FCOL[i][0]};--p:${Math.round(pp)}">
          <div class="ring"><i class="num">${i ? conv(i) : '100%'}</i></div>
          <div><div class="n">${nm}</div><div class="v num">${v}</div></div>
          <div class="lost num">${i ? `−${lost(i)} ירדו` : 'נקודת פתיחה'}</div></div>`;
      }).join('') + `</div>`;
    }
    // layout 6: curved flow (mirrored: starts at right for RTL)
    const W = mob ? 480 : 900, H = mob ? 300 : 380, cy = mob ? 140 : 175, nw = mob ? 12 : 16;
    const xs = stages.map((_, i) => (mob ? 452 : 870) - i * (mob ? 145 : 280));
    const hs = stages.map(([, v]) => Math.max(mob ? 16 : 20, Math.round((mob ? 185 : 240) * Math.pow(v / stages[0][1], .36))));
    let o = `<svg viewBox="0 0 ${W} ${H}"><defs>${grads('h')}</defs>`;
    for (let i = 0; i < N - 1; i++) {
      const x1 = xs[i], x2 = xs[i + 1] + nw, m = (x1 + x2) / 2, a = hs[i] / 2, b = hs[i + 1] / 2;
      o += `<path fill="url(#${uid}h${i})" fill-opacity=".55" d="M${x1},${cy - a} C${m},${cy - a} ${m},${cy - b} ${x2},${cy - b} L${x2},${cy + b} C${m},${cy + b} ${m},${cy + a} ${x1},${cy + a} Z"/>
      <text x="${m}" y="${H - (mob ? 28 : 32)}" text-anchor="middle" class="ftg" font-size="${mob ? 14 : 19}" font-weight="800">${conv(i + 1)}</text>
      <text x="${m}" y="${H - 9}" text-anchor="middle" class="ftr" font-size="${mob ? 11.5 : 14}">−${lost(i + 1)} ירדו</text>`;
    }
    stages.forEach(([nm, v], i) => {
      const x = xs[i], tp = cy - hs[i] / 2;
      o += `<rect x="${x}" y="${tp}" width="${nw}" height="${hs[i]}" rx="6" style="fill:${FCOL[i][0]}"/>
      <text x="${x + nw / 2}" y="${tp - (mob ? 28 : 34)}" text-anchor="middle" font-size="${mob ? 12 : 14}" font-weight="700" style="fill:${FCOL[i][0]}">${nm}</text>
      <text x="${x + nw / 2}" y="${tp - 9}" text-anchor="middle" class="ft" font-size="${mob ? 15 : 18}" font-weight="700">${v}</text>`;
    });
    return o + '</svg>';
  }

  function boardFunnel(el) {
    const urlFl = new URLSearchParams(location.search).get('fl');
    const legacy = localStorage.getItem('wa-funnel-layout');
    if (legacy && !localStorage.getItem('wa-funnel-default')) { localStorage.setItem('wa-funnel-default', legacy); localStorage.removeItem('wa-funnel-layout'); }
    const savedDef = localStorage.getItem('wa-funnel-default') || '1';
    const cur = urlFl || state.funnelLayout || savedDef;
    const setDef = localStorage.getItem('wa-funnel-setdef') === '1';
    const sum = (f) => BOARD.channelFunnels.reduce((a, c) => a + c[f], 0);
    const tot = { leads: sum('leads'), booked: sum('booked'), arrived: sum('arrived'), paid: sum('paid') };
    const totStages = [['לידים', tot.leads], ['קבעו תור', tot.booked], ['הגיעו', tot.arrived], ['שילמו', tot.paid]];
    const rowHtml = (ch) => {
      const e2e = Math.round(ch.paid / ch.leads * 100) + '%';
      const cpp = ch.spend && ch.paid ? ils(Math.round(ch.spend / ch.paid)) : 'ללא עלות';
      return `<tr>
        <td data-h="ערוץ"><b>${ch.name}</b></td>
        <td data-h="לידים" class="num">${ch.leads}</td>
        <td data-h="קבעו תור" class="num">${ch.booked}</td>
        <td data-h="הגיעו" class="num">${ch.arrived}</td>
        <td data-h="שילמו" class="num">${ch.paid}</td>
        <td data-h="המרה מקצה לקצה"><b class="num">${e2e}</b></td>
        <td data-h="עלות למטופל משלם" class="num">${cpp}</td>
        <td data-h="מול חודש קודם"><span style="color:${ch.up ? 'var(--mint-ink)' : 'var(--red)'}">${ch.delta}</span></td>
      </tr>`;
    };
    el.innerHTML = `
      <div class="board-tabs" style="margin-top:0;flex-wrap:wrap;align-items:center">
        ${FN_LAYOUTS.map(([k, l]) => `<button class="board-tab ${cur === k ? 'active' : ''}" data-fl="${k}"><span class="num">${k}</span> · ${l}</button>`).join('')}
        <label class="fn-def"><input type="checkbox" id="fn-def" ${setDef ? 'checked' : ''}> קבע כברירת מחדל</label>
      </div>
      <div class="card" style="margin:0 0 12px"><h3>המשפך הכללי — כל הערוצים</h3>
        ${fnRender(cur, tot, 'agg')}
        ${fnChips(totStages)}
      </div>
      <div class="card" style="margin:0 0 12px"><h3>משפך לפי ערוץ</h3>
        <div class="tbl-wrap"><table class="tbl tbl-rows">
          <thead><tr><th>ערוץ</th><th>לידים</th><th>קבעו תור</th><th>הגיעו</th><th>שילמו</th><th>המרה מקצה לקצה</th><th>עלות למטופל משלם</th><th>מול חודש קודם</th></tr></thead>
          <tbody>${BOARD.channelFunnels.map(rowHtml).join('')}</tbody>
        </table></div>
        <div class="cell-sub" style="margin-top:8px">איזה ערוץ מביא ואיפה הוא נוזל. עלות למטופל משלם = הוצאת הערוץ חלקי מטופלים ששילמו — המספר שאיתו מעבירים תקציב בין ערוצים.</div>
      </div>
      <div class="card" style="margin:0"><h3>זמן מענה ראשון מול אחוז סגירה</h3>
        <div class="att-counters c3">
          <div class="att-counter" style="--ac:var(--ac-green)"><div class="ac-num num">34%</div><div class="ac-label">מענה תוך 5 דקות</div></div>
          <div class="att-counter" style="--ac:var(--ac-orange)"><div class="ac-num num">19%</div><div class="ac-label">מענה תוך שעה</div></div>
          <div class="att-counter" style="--ac:var(--ac-red)"><div class="ac-num num">7%</div><div class="ac-label">מענה מעל שעה</div></div>
        </div>
        <div class="cell-sub" style="margin-top:8px">אחוז הלידים שקבעו תור, לפי זמן המענה הראשון לפנייה (מניתוח ה-webhook של השיחות). מענה מהיר מכפיל את הסיכוי לתור פי כמה — הסיבה שהאוטומציה של המענה הראשון קריטית.</div>
      </div>`;
    const defBox = el.querySelector('#fn-def');
    defBox.onchange = () => {
      localStorage.setItem('wa-funnel-setdef', defBox.checked ? '1' : '0');
      if (defBox.checked) localStorage.setItem('wa-funnel-default', state.funnelLayout || cur);
    };
    el.querySelectorAll('[data-fl]').forEach(b => b.onclick = () => {
      state.funnelLayout = b.dataset.fl;
      if (defBox.checked) localStorage.setItem('wa-funnel-default', b.dataset.fl);
      boardFunnel(el);
    });
  }

  function boardAttention(el) {
    const colors = ['var(--ac-red)', 'var(--ac-orange)', 'var(--ac-blue)', 'var(--ac-purple)'];
    el.innerHTML = `
      <div class="att-counters">
        ${BOARD.attention.map((g, i) => `<div class="att-counter has-tip" data-tip="${TIP[g.title] || ''}" tabindex="0" style="--ac:${colors[i % 4]}">
          <div class="ac-num num">${g.rows.length}</div><div class="ac-label">${g.title}<span class="info-i">i</span></div>
        </div>`).join('')}
      </div>
      ${BOARD.attention.map((g, i) => `<details class="att-list card" style="--ac:${colors[i % 4]};margin:0 0 12px">
        <summary><span class="att-title">${g.title}</span><span class="att-badge num">${g.rows.length}</span><span class="att-caret">◂</span></summary>
        ${g.rows.map(r => `<div class="att-row">
          <div class="a-top"><span class="a-name">${r.name}</span><span class="num cell-sub" style="direction:ltr">${r.phone}</span><span class="badge blue">${r.topic}</span></div>
          <div class="cell-sub">${r.ago}</div>
        </div>`).join('')}
      </details>`).join('')}
      <div class="guide">במערכת המלאה הרשימה נקראת ישירות מאיזיביזי בכל טעינה; פרטי מטופלים לא נשמרים בדשבורד.</div>`;
  }

  function boardMessages(el) {
    const tile = (label, value, sub, color) => `<div class="msg-tile has-tip" data-tip="${TIP[label] || ''}" tabindex="0" style="--ac:${color}">
      <div class="msg-num num">${value}</div><div class="msg-label">${label}<span class="info-i">i</span></div>${sub ? `<div class="msg-sub num">${sub}</div>` : ''}
    </div>`;
    el.innerHTML = BOARD.templates.map(t => {
      const ap = Math.round(t.answered / t.sent * 100);
      return `<div class="card" style="margin:0 0 12px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px"><h4 style="margin:0">${t.name}</h4><span class="badge">\u05EA\u05D1\u05E0\u05D9\u05EA</span></div>
        <div class="msg-stats">
          ${tile('\u05E0\u05E9\u05DC\u05D7\u05D5', t.sent, '', 'var(--ac-blue)')}
          ${tile('\u05E2\u05E0\u05D5', t.answered, ap + '% \u05DE\u05D4\u05E0\u05E9\u05DC\u05D7\u05D5', 'var(--ac-green)')}
          ${tile('\u05E7\u05D1\u05E2\u05D5 \u05EA\u05D5\u05E8', t.booked == null ? '\u2014' : t.booked, '', 'var(--ac-orange)')}
          ${tile('\u05E2\u05DC\u05D5\u05EA \u05E9\u05DC\u05D9\u05D7\u05D4', ils(t.cost), t.unsub ? `${t.unsub} \u05D1\u05D9\u05E7\u05E9\u05D5 \u05D4\u05E1\u05E8\u05D4` : '', 'var(--ac-purple)')}
        </div>
      </div>`;
    }).join('');
  }

  const MAP_STAMP = '<span class="badge yellow">טרם אומת מול Render</span>';
  const MAP_HOOKS = [
    { ev: 'whatsapp-messages.received · הודעה נכנסת', evd: 'מטופל כותב לקליניקה בוואטסאפ',
      act: 'רישום ניתוח שיחה: תזמוני הודעות, מי כתב אחרון (אוטומטי/צוות), דגלים מהטקסט (בקשת הסרה · חזרו אליי · לא עכשיו), נושא הפנייה הראשונה',
      mod: 'easybizy_webhook.py', mode: 'מצב analyze' },
    { ev: 'הודעה נכנסת עם בקשת שינוי/ביטול תור', evd: 'למשל "לא אוכל להגיע", "אפשר לדחות?"',
      act: 'אם למטופל יש תור ב-3 הימים הקרובים — כתיבת הערה בכרטיס הלקוח באיזיביזי, כדי שהמזכירה תחזור אליו ותמלא מחדש את התור. לא נשלחת הודעה למטופל',
      mod: 'appt_confirm.py', mode: 'מצב apply / preview' },
    { ev: 'הודעה ראשונה עם "מספר פנייה" מהאתר', evd: 'קוד בן 5 תווים שהתוסף שותל בטקסט הפתיחה',
      act: 'שיוך מקור האתר (פרמטרי קמפיין, דף נחיתה, מאתר מפנה) לשיחה — לשיוך לידים לקמפיינים',
      mod: 'site_wa_ref.py', mode: 'מצב preview' },
    { ev: 'whatsapp-messages.received / delivered · הודעה יוצאת', evd: 'הצוות או המערכת עונים למטופל',
      act: 'רישום זמני מענה של הצוות: מתי נענה, כמה זמן חיכתה פנייה ראשונה — מזין את הדשבורד ואת עדכון הסטטוסים',
      mod: 'easybizy_webhook.py', mode: 'מצב analyze' },
    { ev: 'whatsapp-messages.failed', evd: 'שליחה נכשלה אצל הספק',
      act: 'תיעוד תקלת השליחה: שם התבנית ושגיאת הספק (מטושטשת) בלוג בלבד',
      mod: 'easybizy_webhook.py', mode: 'כל המצבים' },
  ];
  const MAP_SCHED = [
    { ev: 'נתוני שיחה מה-webhook · ריצה מתוזממת', evd: 'סריקה תקופתית של נתוני השיחות והלידים',
      act: 'מזיז סטטוס ראשי בליד באיזיביזי: חדש→פעיל כשהצוות ענה, מושהה→פעיל כשהליד חזר לכתוב, פעיל→מושהה אחרי 24 שעות בלי מענה, מושהה→לא פעיל שבוע אחרי הפולואפ, לא פעיל בבקשת הסרה מפורשת',
      mod: 'status_moves.py', mode: 'השהיה מכוונת: 24 שעות / 7 ימים' },
    { ev: 'נתוני שיחה מה-webhook · ריצה מתוזממת', evd: 'ליד מושהה שלא ענה לצוות 24 שעות',
      act: 'שולח תבנית פולואפ בוואטסאפ דרך ה-API של איזיביזי — פעם אחת לליד, בלבד',
      mod: 'followup_send.py', mode: 'חלון שליחה: א-ה 19:30-20:00' },
  ];
  const MAP_EXCLUDED = ['קליטת הפניות מטא (CTWA)', 'אינסטגרם (קליטה + ניהול)', 'שיחה שלא נענתה (Twilio)', 'תוסף האתר (/site/wa-ref)', 'סנכרון תורים ותשלומים ל-Optione (booking_sync)', 'תיוג קמפיינים (campaign_sync)', 'הנחיות לפני פייסטייט', 'MedReviews', 'ניטור חשבון וואטסאפ', 'בדיקת חיבור לאיזיביזי', 'דוחות מתוזמנים (הכנסות, מקורות, לידים חסרים)'];

  function boardMapping(el) {
    const tblHead = '<thead><tr><th>וובהוק מאיזיביזי</th><th>הפעולה שמתבצעת</th><th>מודול</th><th>מצב</th><th>אימות</th></tr></thead>';
    const row = (h) => `<tr>
      <td data-h="וובהוק מאיזיביזי"><b>${h.ev}</b><span class="map-sub">${h.evd}</span></td>
      <td data-h="הפעולה שמתבצעת">${h.act}</td>
      <td data-h="מודול"><span class="badge blue">${h.mod}</span></td>
      <td data-h="מצב"><span class="badge">${h.mode}</span></td>
      <td data-h="אימות">${MAP_STAMP}</td>
    </tr>`;
    const tbl = (rows) => `<div class="tbl-wrap"><table class="tbl">${tblHead}<tbody>${rows.map(row).join('')}</tbody></table></div>`;
    el.innerHTML = `
      <div class="att-counters c3">
        <div class="att-counter" style="--ac:var(--ac-blue)"><div class="ac-num num">${MAP_HOOKS.length}</div><div class="ac-label">שרשראות webhook ← פעולה</div></div>
        <div class="att-counter" style="--ac:var(--ac-orange)"><div class="ac-num num">${MAP_SCHED.length}</div><div class="ac-label">עם תזמון/השהייה מכוונת</div></div>
        <div class="att-counter" style="--ac:var(--yellow)"><div class="ac-num num">${MAP_HOOKS.length + MAP_SCHED.length}</div><div class="ac-label">שורות הממתינות לאימות Render</div></div>
      </div>
      <div class="alert-strip" style="margin-bottom:12px"><span class="as-ico">ℹ</span><span>המיפוי מבוסס על קוד ה-Git (ziv-whatsapp-attribution, 24.11.2026) בלבד. כל שורה מסומנת <b>טרם אומת מול Render</b> עד להשלמת הגדרות הפריסה והלוגים. נקודת הקליטה: <span class="num">POST /easybizy/webhook</span> עם אימות סוד משותף.</span></div>
      <div class="card" style="margin:0 0 12px"><h3>וובהוק מאיזיביזי ← פעולה</h3>${tbl(MAP_HOOKS)}</div>
      <div class="card" style="margin:0 0 12px"><h3>מופעלות מה-webhook עם תזמון או השהייה מכוונת</h3>${tbl(MAP_SCHED)}</div>
      <details class="att-list card" style="margin:0"><summary><span class="att-title">לא נכללו במיפוי</span><span class="badge">${MAP_EXCLUDED.length} מערכות</span><span class="att-caret">◂</span></summary>
        <div class="cell-sub" style="margin:6px 16px 12px">למערכות אלה אין webhook שמגיע מאיזיביזי, ולכן הן מחוץ למיפוי לפי ההגדרה: ${MAP_EXCLUDED.join(' · ')}</div>
      </details>`;
  }

  const FM_ST = {
    yes: ['<span class="badge green"><span class="dot"></span>קיים בקוד</span>', 'var(--mint-ink)'],
    part: ['<span class="badge yellow">חלקית</span>', 'var(--yellow)'],
    no: ['<span class="badge">לא קיים</span>', 'var(--muted)'],
  };
  const FM_PAGES = [
    { page: 'מבט כללי', rows: [
      ['לידים (היום / השבוע / החודש)', 'איזיביזי API — רשימת לידים', 'yes', 'אינדקס לידים (campaign_sync) + dash_feed'],
      ['גרף לידים 14 ימים', 'איזיביזי API — תאריכי יצירת לידים', 'yes', 'dash_feed'],
      ['לידים לפי ערוץ (דונאט)', 'תיוג מקור בלידים באיזיביזי', 'part', 'מטא (campaign_sync) ואתר (source_tags + site_wa_ref) קיימים; אורגני מחושב כ"ללא תג"; שיחה/MedReviews תלויים בתיוג קיים באיזיביזי'],
      ['הוצאת פרסום', 'Meta Marketing API — insights', 'yes', 'dash_feed + revenue_report (ללא מע"מ)'],
      ['הכנסה בטווח', 'איזיביזי API — מסמכים משלמים (קבלה/חשבונית-קבלה)', 'yes', 'revenue_report'],
      ['החזר על ההוצאה / עלות לליד / עלות להמרה', 'נגזר מהשדות שמעל', 'yes', 'חישוב בדשבורד'],
      ['אחוז המרה לערוץ', 'נגזר: לידים ← תורים שנקבעו', 'part', 'דורש קריאת תורים לפי ליד — לא נאספת היום'],
      ['תורים שנקבעו / עסקאות נסגרו', 'איזיביזי API — תורים + מסמכים', 'part', 'booking_sync קורא אותם (לסנכרון Optione) אבל לא צובר ספירות לדשבורד'],
    ]},
    { page: 'קמפיינים', rows: [
      ['הוצאה / הכנסה / החזר לקמפיין', 'Meta API + איזיביזי מסמכים (שיוך לפי תג קמפיין)', 'yes', 'revenue_report + dash_feed'],
      ['לידים לקמפיין', 'איזיביזי — לידים עם תג "[מטא:id]"', 'yes', 'אינדקס לידים (campaign_sync)'],
      ['קבעו תור / הגיעו לקמפיין', 'איזיביזי API — תורים של לידים מתויגים + סטטוס תור', 'part', 'ניתן להביא; לא נאסף היום'],
      ['שילמו / עלות למטופל משלם', 'איזיביזי מסמכים + נגזר', 'yes', 'revenue_report'],
      ['גרף התקדמות לידים', 'שילוב לידים + תורים + מסמכים', 'part', 'לידים ושילמו קיימים; תורים חסרים'],
    ]},
    { page: 'משפך', rows: [
      ['שלבי המשפך לקמפיין (לידים ← קבעו ← הגיעו ← שילמו)', 'כמו בדף קמפיינים', 'part', 'לידים + שילמו קיימים; קבעו/הגיעו דורשים קריאת תורים'],
    ]},
    { page: 'דורשים טיפול', rows: [
      ['דגלים: בקשת הסרה / חזרו אליי / לא עכשיו', 'נתוני ה-webhook (ניתוח טקסט)', 'yes', 'easybizy_webhook (ConvStore)'],
      ['זמן מענה ראשון לפנייה', 'נתוני ה-webhook', 'yes', 'dash_feed'],
      ['רשימת לידים/מטופלים עם שם וטלפון', 'איזיביזי API — קריאה ישירה בזמן אמת', 'no', 'השרת לא שומר פרטי מטופלים (מדיניות); הדשבורד יקרא ישירות מאיזיביזי'],
    ]},
    { page: 'הודעות אוטומטיות', rows: [
      ['נשלחו', 'איזיביזי API — קמפיינים/שליחות', 'part', 'לפולואפ של השרת יש יומן שליחות; קמפיינים של איזיביזי דורשים API'],
      ['ענו', 'נתוני ה-webhook', 'yes', 'easybizy_webhook (ConvStore)'],
      ['קבעו תור אחרי שליחה', 'נגזר: webhook + תורים', 'part', 'דורש קריאת תורים'],
      ['ביקשו הסרה', 'נתוני ה-webhook (דגל stop)', 'yes', 'easybizy_webhook'],
      ['עלות שליחה', 'איזיביזי / ספק וואטסאפ', 'no', 'אין מקור בקוד היום'],
    ]},
    { page: 'מצב המערכות', rows: [
      ['סטטוסי מערכות ותקלות', 'לוגים פנימיים של השרת', 'part', 'server_report (status_daily + צ\u2019קים) קיים בלוג; דורש חשיפה לדשבורד'],
    ]},
  ];

  function boardFieldMap(el) {
    const all = FM_PAGES.flatMap(p => p.rows);
    const cnt = (st) => all.filter(r => r[2] === st).length;
    const rowHtml = (r) => `<tr>
      <td data-h="שדה בדשבורד"><b>${r[0]}</b></td>
      <td data-h="מקור אפשרי">${r[1]}</td>
      <td data-h="קיים בקוד">${FM_ST[r[2]][0]}</td>
      <td data-h="הערה"><span class="map-sub">${r[3]}</span></td>
    </tr>`;
    const tblHead = '<thead><tr><th>שדה בדשבורד</th><th>מקור אפשרי</th><th>קיים בקוד</th><th>הערה</th></tr></thead>';
    el.innerHTML = `
      <div class="att-counters c3">
        <div class="att-counter" style="--ac:var(--mint-ink)"><div class="ac-num num">${cnt('yes')}</div><div class="ac-label">קיימים בקוד השרת</div></div>
        <div class="att-counter" style="--ac:var(--yellow)"><div class="ac-num num">${cnt('part')}</div><div class="ac-label">חלקית / דורשים הרחבה</div></div>
        <div class="att-counter" style="--ac:var(--muted)"><div class="ac-num num">${cnt('no')}</div><div class="ac-label">לא קיימים</div></div>
      </div>
      <div class="alert-strip" style="margin-bottom:12px"><span class="as-ico">ℹ</span><span>לכל שדה בדשבורד: מאיפה אפשר להביא את הנתון, והאם השרת כבר קורא או מפיק אותו <b>לפי קוד ה-Git</b> (24.11.2026). העמודה "קיים" משקפת את הקוד בלבד — ${'טרם אומת מול Render'}.</span></div>
      ${FM_PAGES.map(pg => `<div class="card" style="margin:0 0 12px"><h3>${pg.page}</h3><div class="tbl-wrap"><table class="tbl">${tblHead}<tbody>${pg.rows.map(rowHtml).join('')}</tbody></table></div></div>`).join('')}`;
  }

  const WP_ST = {
    built: '<span class="badge green"><span class="dot"></span>קיים בקוד</span>',
    preview: '<span class="badge yellow">בתצוגה מקדימה</span>',
    pending: '<span class="badge">ממתין</span>',
    ziv: '<span class="badge blue">אצל זיו / איזיביזי</span>',
  };
  const WP_STAGES = [
    { stage: 'שלב 1 — לסגור את מה שכבר בנוי', items: [
      ['שיוך כפתור הוואטסאפ של האתר לאיזיביזי (תגית והערה)', 'built', 'site_wa_ref.py — תצוגה מקדימה; נדרש אימות מול Render והפעלה'],
      ['זיהוי בקשות שינוי תור — מעבר מתצוגה מקדימה לפעולה', 'preview', 'appt_confirm.py; אחרי בדיקת יומנים מחליפים מצב ל-apply'],
      ['טופס בדיקה מהאתר ממספר חדש + אימות הטריגר', 'pending', 'בדיקה ידנית; לא דורש קוד חדש'],
      ['קוד תוסף האתר והבדיקות למאגר git', 'pending', 'לרכז במאגר (כיום מחוץ ל-git)'],
      ['בדיקת יעדי "CF7 to Webhook"', 'pending', 'בדיקה מול הגדרות היעד'],
      ['מסרון מבנה המודעות מזיו לדור + יישום בקמפיינים חדשים', 'ziv', 'משימה של זיו'],
      ['כיבוי "ליד נכנס מאתר" באופטיוואן', 'ziv', 'הגדרה באופטיוואן'],
    ]},
    { stage: 'שלב 2 — סטטוסים', items: [
      ['מודול הסטטוסים בתצוגה מקדימה', 'preview', 'status_moves.py קיים; קובע סטטוס ורושם בלבד'],
      ['שבוע השוואה בין הסטטוס האוטומטי לסטטוס בפועל + אישור זיו', 'pending', 'ריצת השוואה שבועית'],
      ['מעבר לכתיבה אמיתית', 'pending', 'החלפת מצב ל-apply אחרי האישור'],
      ['בירור שאלות מול ה-API של איזיביזי (עדכון סטטוס, סימון הגעה, קישור ליד-לקוח)', 'ziv', 'בירור מול דניאל'],
    ]},
    { stage: 'שלב 3 — הודעות לפי סטטוס', note: 'נבנה בשרת רק אם איזיביזי לא תכסה — לברר עם דניאל מה כולל הקמפיין האוטומטי לפי סטטוס ומתי הוא מגיע', items: [
      ['מודול ההודעות בתצוגה מקדימה (תזמון, ביטולים, מכסות, הסרה)', 'preview', 'status_auto.py קיים כ-preview; ממתין להחלטה מול איזיביזי'],
      ['אישור זיו לטבלת הכללים והנוסחים + בדיקת עורך דין', 'ziv', 'נוסחים בדף 14-15 של האפיון'],
      ['ארבע תבניות עם כפתורים — שליחה לאישור מטא', 'pending', 'ניסוח ופתיחת תבניות'],
      ['הפעלה כלל אחר כלל + כיבוי פולו-אפ 48 שעות באופטיוואן', 'pending', 'אחרי אישור התבניות'],
      ['דוח שבועי לכל נוסח', 'pending', 'מודול דוח חדש'],
    ]},
    { stage: 'שלב 4 — השלמת השיוך וההכנסה', items: [
      ['דוח הכנסה חודשי לפי ערוץ וקמפיין', 'built', 'revenue_report.py'],
      ['לידים מאינסטגרם לאיזיביזי עם מקור', 'built', 'ig_intake.py + תגית "אינסטגרם"'],
      ['מיפוי 187 המודעות + אימות פרמטרי utm', 'pending', 'מיפוי שמות לכל המודעות הפעילות'],
      ['דיווח המרות למטא (Conversions API)', 'pending', 'דורש אישור מפורש של זיו + אסימון ממנהל האירועים; רק אחרי שהסטטוסים עובדים ונבדקו'],
    ]},
    { stage: 'שלב 5 — מתקדם', items: [
      ['תבניות עם תמונה לפי טיפול + השוואת נוסחים', 'pending', 'אחרי שלב 3'],
      ['הצעת תשובה למזכירה לפי השיחה, לאישור בלחיצה', 'pending', 'מודול חדש'],
      ['המרות לא מקוונות לגוגל אדס', 'pending', 'התוסף כבר שומר את מזהה הקליק ב-UTM; נדרשת העלאת המרות לגוגל'],
    ]},
    { stage: 'שלב 6 — דשבורד ניהול (הדמו הזה)', items: [
      ['מסכי מבט כללי, קמפיינים, משפך, דורשים טיפול, הודעות, מצב מערכות', 'preview', 'קיימים כדמו בדף הזה; ראו "מיפוי שדות הדשבורד" למקורות הנתונים'],
      ['חיבור קריאה-בלבד להוצאות הפרסום במטא ובגוגל אדס', 'pending', 'מטא נקרא כבר ב-revenue_report; גוגל אדס דורש חיבור API'],
      ['התחברות והרשאות + בדיקה בטלפון', 'pending', 'הדמו פתוח בכוונה; בגרסת הייצור נדרש לוגין'],
    ]},
  ];

  function boardWorkPlan(el) {
    const all = WP_STAGES.flatMap(p => p.items);
    const cnt = (st) => all.filter(r => r[1] === st).length;
    const rowHtml = (r) => `<tr>
      <td data-h="משימה"><b>${r[0]}</b></td>
      <td data-h="מצב">${WP_ST[r[1]]}</td>
      <td data-h="מה נדרש"><span class="map-sub">${r[2]}</span></td>
    </tr>`;
    const tblHead = '<thead><tr><th>משימה</th><th>מצב</th><th>מה נדרש להשלמה</th></tr></thead>';
    el.innerHTML = `
      <div class="att-counters c4">
        <div class="att-counter" style="--ac:var(--mint-ink)"><div class="ac-num num">${cnt('built')}</div><div class="ac-label">קיימים בקוד</div></div>
        <div class="att-counter" style="--ac:var(--yellow)"><div class="ac-num num">${cnt('preview')}</div><div class="ac-label">בתצוגה מקדימה</div></div>
        <div class="att-counter" style="--ac:var(--orange)"><div class="ac-num num">${cnt('pending')}</div><div class="ac-label">ממתינים</div></div>
        <div class="att-counter" style="--ac:var(--ac-blue)"><div class="ac-num num">${cnt('ziv')}</div><div class="ac-label">אצל זיו / איזיביזי</div></div>
      </div>
      <div class="alert-strip" style="margin-bottom:12px"><span class="as-ico">ℹ</span><span>לפי מסמך האפיון של הקליניקה ("מסמך מערכת מלא", 14.11.2026), בהשוואה לקוד ה-Git (24.11.2026) — <b>טרם אומת מול Render</b>. הכלל המנחה באפיון: מה שאיזיביזי יכולה לעשות בעצמה עדיף על פתרון בשרת.</span></div>
      ${WP_STAGES.map(pg => `<div class="card" style="margin:0 0 12px"><h3>${pg.stage}</h3>${pg.note ? `<div class="cell-sub" style="margin:0 0 10px">${pg.note}</div>` : ''}<div class="tbl-wrap"><table class="tbl">${tblHead}<tbody>${pg.items.map(rowHtml).join('')}</tbody></table></div></div>`).join('')}`;
  }

  function boardSystems(el) {
    const badge = (s) => s === 'פעיל' ? '<span class="badge green"><span class="dot"></span>פעיל</span>'
      : s === 'תצוגה מקדימה' ? '<span class="badge yellow">תצוגה מקדימה</span>' : '<span class="badge">לא נבנה</span>';
    const count = (st) => BOARD.systems.filter(s => s.status === st).length;
    const counters = [
      ['פעיל', count('פעיל'), 'var(--mint-ink)'],
      ['תצוגה מקדימה', count('תצוגה מקדימה'), 'var(--yellow)'],
      ['לא נבנה', count('לא נבנה'), 'var(--muted)'],
    ];
    el.innerHTML = `
      <div class="att-counters c3">
        ${counters.map(([label, n, c]) => `<div class="att-counter has-tip" data-tip="${TIP[label] || ''}" tabindex="0" style="--ac:${c}">
          <div class="ac-num num">${n}</div><div class="ac-label">${label}<span class="info-i">i</span></div>
        </div>`).join('')}
      </div>
      <div class="sys-grid">
        ${BOARD.systems.map(s => `<div class="sys-tile"><div class="sys-tile-top"><span class="sys-name">${s.name}</span>${badge(s.status)}</div><span class="sys-meta">${s.meta}</span></div>`).join('')}
      </div>
      <div class="alert-strip" style="margin-top:14px"><span class="as-ico">⚠</span><span><b>תקלות:</b> ${BOARD.sysErrors}</span></div>`;
  }

  /* ---------------- router ---------------- */
  function route() {
    const h = location.hash || '#/clients';
    const [, page, a, b] = h.split('/');
    if (page === 'board') return viewBoard(a || 'overview');
    if (!Api.isLoggedIn() && h !== '#/login') return viewLogin();
    if (h === '#/login') return viewLogin();
    if (page === 'clients') return viewClients(a === 'new');
    if (page === 'activity') return viewActivityPage();
    if (page === 'client' && a) {
      const parts = h.split('/');
      if (parts[3] === 'builder') return viewBuilder(a, parts[4] || null);
      if (parts[3] === 'automation') return viewAutomation(a, parts[4] || null);
      return viewClient(a, parts[3] || 'dash');
    }
    viewClients();
  }
  window.addEventListener('hashchange', route);
  route();
})();
