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
  function shell(active, inner, clientNav, brand, screen) {
    const who = brand === 'clinic' || brand === 'tech' ? `
          <div class="who"><span class="demo-pill">תצוגת דמו</span></div>` : `
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
          <a class="nav-item ${screen === 'overview' ? 'active' : ''}" href="#/"><span class="ico">◔</span> סקירה כללית</a>
          <a class="nav-item ${screen === 'attention' ? 'active' : ''}" href="#/attention"><span class="ico">⚑</span> דורש טיפול <span class="nav-badge num">${ATTN_TOTAL()}</span></a>
          <a class="nav-item ${screen === 'channels' ? 'active' : ''}" href="#/channels"><span class="ico">◫</span> ערוצים וקמפיינים</a>
          <a class="nav-item ${screen === 'messages' ? 'active' : ''}" href="#/messages"><span class="ico">✉</span> הודעות אוטומטיות</a>
          <a class="nav-item ${screen === 'status' ? 'active' : ''}" href="#/status"><span class="ico">▣</span> סטטוס</a>`
        : brand === 'tech' ? `
          <a class="back-link" href="#/" style="padding:4px 12px">→ דשבורד הלקוח</a>
          <div class="client-nav-head"><div class="cn-name">אזור טכני</div><span class="badge yellow">דמו</span></div>
          ${TECH_PAGES.map(([k, l]) => `<a class="nav-item ${screen === k ? 'active' : ''}" href="#/tech${k === 'home' ? '' : '/' + k}"><span class="ico">▸</span> ${l}</a>`).join('')}`
        : `
          <a class="nav-item ${active === 'clients' ? 'active' : ''}" href="#/clients"><span class="ico">▦</span> לקוחות</a>
          ${Api.demoMode || !Api.isLoggedIn() ? `<a class="nav-item" href="#/"><span class="ico">◔</span> דשבורד קליניקה (דמו)</a><a class="nav-item" href="#/tech"><span class="ico">⚙</span> אזור טכני (דמו)</a>` : ''}`;
    root.innerHTML = `
      <div class="layout">
        <div class="topbar">
          <button class="icon-btn" id="nav-burger" title="תפריט">☰</button>
          ${brand === 'clinic' || brand === 'tech'
            ? '<span class="brand"><img class="logo brand-light-only" src="assets/clinic-logo-dark.png" alt="Dr. Ziv Peretz" style="width:auto;height:28px;border-radius:0"><img class="logo brand-dark-only" src="assets/clinic-logo-white.png" alt="Dr. Ziv Peretz" style="width:auto;height:28px;border-radius:0"> דשבורד ניהול</span>'
            : '<span class="brand"><img class="logo" src="assets/logo-icon.png" alt="Tech Mate"> WhatsApp Manager</span>'}
          ${brand === 'clinic' ? `<span class="tp-pills">${CPERIODS.map(([k, l]) => `<a class="tp-pill ${curPeriod() === k ? 'active' : ''}" href="${periodUrl(k)}">${l}</a>`).join('')}</span><span class="upd"><span class="sdot ok"></span>${CLINIC.updatedAgo}</span>` : ''}
          <button class="icon-btn" id="theme-toggle" title="מצב כהה / בהיר">◐</button>
        </div>
        <div class="nav-overlay" id="nav-overlay"></div>
        <aside class="sidebar">
          ${brand === 'clinic' || brand === 'tech'
            ? `<div class="brand column"><img class="logo-lg brand-light-only" src="assets/clinic-logo-dark.png" alt="Dr. Ziv Peretz" style="width:120px;border-radius:0"><img class="logo-lg brand-dark-only" src="assets/clinic-logo-white.png" alt="Dr. Ziv Peretz" style="width:120px;border-radius:0"><span class="brand-name">${brand === 'tech' ? 'אזור טכני' : 'דשבורד ניהול'}<span class="brand-sub">Dr. Ziv Peretz · Aesthetic Clinic</span></span></div>`
            : '<div class="brand column"><img class="logo-lg" src="assets/logo-icon.png" alt="Tech Mate"><span class="brand-name">WhatsApp Manager<span class="brand-sub">for EasyBizy</span></span></div>'}
          ${nav}
          <div class="spacer"></div>
          ${who}
        </aside>
        <main class="main">${inner}</main>
        ${brand === 'clinic' ? `
        <nav class="bottomnav">
          <a href="#/" class="${screen === 'overview' ? 'active' : ''}"><span class="bn-ico">◔</span>סקירה</a>
          <a href="#/attention" class="${screen === 'attention' ? 'active' : ''}"><span class="bn-ico">⚑</span>דורש טיפול<b class="bn-badge num">${ATTN_TOTAL()}</b></a>
          <a href="#/channels" class="${screen === 'channels' ? 'active' : ''}"><span class="bn-ico">◫</span>ערוצים</a>
          <a href="#/messages" class="${screen === 'messages' ? 'active' : ''}"><span class="bn-ico">✉</span>הודעות</a>
          <a href="#/status" class="${screen === 'status' ? 'active' : ''}"><span class="bn-ico">⋯</span>עוד</a>
        </nav>` : ''}
      </div>`;
    const logoutEl = document.getElementById('logout');
    if (logoutEl) logoutEl.onclick = (e) => { e.preventDefault(); Api.logout(); };
    document.getElementById('theme-toggle').onclick = () => Theme.toggle();
    const closeNav = () => document.body.classList.remove('nav-open');
    document.getElementById('nav-burger').onclick = () => document.body.classList.toggle('nav-open');
    document.getElementById('nav-overlay').onclick = closeNav;
    document.body.classList.toggle('has-bottomnav', brand === 'clinic');
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
  /* ---------------- clinic dashboard (demo per spec 25.11.2026; sample data only) ---------------- */
  const ils = (n) => '₪' + n.toLocaleString('he-IL');
  const TIP = {
    'לידים היום': 'לידים חדשים שנכנסו היום — קבוע להיום, לא מושפע מבורר התקופה',
    'לידים': 'לידים חדשים בתקופה הנבחרת; ליד חוזר בתוך 90 יום נספר פעם אחת',
    'תורים שנקבעו': 'תורים שנקבעו בתקופה — מדד פעילות (לפי תאריך קביעה)',
    'מטופלים משלמים חדשים': 'לידים מהקוהורט ששילמו לראשונה — מדד קוהורט (לפי תאריך ליד)',
    'הכנסות': 'כל התשלומים בקליניקה בתקופה, כולל לא ממומן',
    'הכנסות משויכות': 'הכנסות ממטופלים ששולמו עד 180 יום מהליד, משויכות לקמפיינים ממומנים בלבד',
    'הוצאת פרסום': 'הוצאת הפרסום בפועל בתקופה (מטא; גוגל כשיחובר)',
    'החזר על ההוצאה': 'הכנסות משויכות חלקי הוצאת פרסום — אותה נוסחה בכל מסך',
    'עלות לליד': 'הוצאת הפרסום חלקי מספר הלידים',
    'עלות למטופל משלם': 'הוצאת הערוץ חלקי מטופלים ששילמו — המספר שאיתו מעבירים תקציב בין ערוצים',
    'נשלחו': 'כמה הודעות נשלחו בתקופה',
    'ענו': 'כמה ענו להודעה, ואחוזם מכלל הנשלחו',
    'קבעו תור': 'כמה קבעו תור בעקבות ההודעה',
    'עלות משוערת': 'הערכה: עלות מנוי חודשי לספק חלקי הודעות, בתוספת תעריף שיחה — משוער, לא חיוב בפועל',
    'פעיל': 'המקור עובד ומעדכן כרגיל',
    'בתצוגה מקדימה': 'רכיב בהרצת ניסיון לפני הפעלה מלאה',
    'טרם חובר': 'מקור מתוכנן שעוד לא חובר — הנתונים שלו לא נכללים בדוחות',
  };
  const CLINIC = {
    name: 'ד"ר זיו פרץ · קליניקה אסתטית',
    updatedAgo: 'עודכן לפני 12 דקות',
    followup: 'א׳–ה׳ 19:30–20:00',
  };
  const CPERIODS = [['today', 'היום'], ['week', 'השבוע'], ['month', 'החודש'], ['prevmonth', 'חודש קודם'], ['q90', '90 ימים'], ['custom', 'טווח תאריכים']];
  const PSCALE = { today: .05, week: .26, month: 1, prevmonth: .93, q90: 2.83, custom: .62 };
  const PDELTAS = {
    today: { leads: '+2 מול אתמול', booked: '+1 מול אתמול', paying: 'כמו אתמול', rev: '+12% מול אתמול' },
    week: { leads: '+6% מול שבוע קודם', booked: '+3 מול שבוע קודם', paying: '−1 מול שבוע קודם', rev: '+9% מול שבוע קודם' },
    month: { leads: '+8% מול חודש קודם', booked: '+5 מול חודש קודם', paying: '−1 מול חודש קודם', rev: '+15% מול חודש קודם' },
    prevmonth: { leads: 'החודש: 184 (+8%)', booked: 'מול 62 החודש', paying: 'מול 23 החודש', rev: 'מול ₪128,400 החודש' },
    q90: { leads: '+11% מול 90 הקודמים', booked: '+9%', paying: '+6%', rev: '+13%' },
    custom: { leads: 'נתוני דמו', booked: 'נתוני דמו', paying: 'נתוני דמו', rev: 'נתוני דמו' },
  };
  /* Canonical month dataset — every screen derives from these rows so numbers
     are consistent everywhere (spec §3, R1). */
  const CD = {
    revenue: 128400,
    channels: [
      { key: 'meta_wa_ads', name: 'מודעות מטא בוואטסאפ', leads: 96, booked: 38, arrived: 29, paid: 20, spend: 10830, delta: '+9% לידים', up: true },
      { key: 'meta_lead_form', name: 'טופס לידים מטא', leads: 21, booked: 6, arrived: 4, paid: 1, spend: 1500, delta: '+4 לידים', up: true },
      { key: 'organic_wa', name: 'אורגני / וואטסאפ ישיר', leads: 38, booked: 10, arrived: 7, paid: 1, spend: 0, delta: '+6% לידים', up: true },
      { key: 'website', name: 'אתר הקליניקה', leads: 12, booked: 4, arrived: 3, paid: 1, spend: 0, delta: 'ללא שינוי', up: true },
      { key: 'missed_call', name: 'שיחה שלא נענתה', leads: 10, booked: 3, arrived: 2, paid: 0, spend: 0, delta: '+2 לידים', up: true },
      { key: 'medreviews', name: 'MedReviews', leads: 7, booked: 1, arrived: 0, paid: 0, spend: 0, delta: '−1 ליד', up: false },
    ],
    campaigns: [
      { key: 'c1', name: 'פייסטייט – נשים +35 – וידאו 1', channel: 'meta_wa_ads', treatment: 'פייסטייט', status: 'פעיל', spend: 4200, leads: 34, booked: 14, arrived: 11, paid: 8, rev: 36500 },
      { key: 'c2', name: 'מורפיאוס 8 – נשים – תמונה 2', channel: 'meta_wa_ads', treatment: 'מורפיאוס 8', status: 'פעיל', spend: 3300, leads: 27, booked: 10, arrived: 8, paid: 5, rev: 24100 },
      { key: 'c3', name: 'בוטוקס – קהל רחב – רילס 1', channel: 'meta_wa_ads', treatment: 'בוטוקס', status: 'פעיל', spend: 2100, leads: 18, booked: 7, arrived: 5, paid: 4, rev: 19800 },
      { key: 'c4', name: 'השתלת שיער – גברים – וידאו 3', channel: 'meta_wa_ads', treatment: 'השתלת שיער', status: 'מושהה', spend: 1230, leads: 9, booked: 4, arrived: 3, paid: 2, rev: 9400 },
      { key: 'c5', name: 'טופס לידים – רילס אינסטגרם', channel: 'meta_lead_form', treatment: 'מורפיאוס 8', status: 'פעיל', spend: 1500, leads: 21, booked: 6, arrived: 4, paid: 1, rev: 4100 },
      { key: 'unmapped', name: 'לא משויך לקמפיין', channel: 'meta_wa_ads', treatment: '—', status: '', spend: 0, leads: 8, booked: 3, arrived: 2, paid: 1, rev: 2300, unmapped: true },
      { key: 'organic_wa', name: 'אורגני / וואטסאפ ישיר', channel: 'organic_wa', treatment: '—', status: '', spend: 0, leads: 38, booked: 10, arrived: 7, paid: 1, rev: 0, revNull: true, src: true },
      { key: 'website', name: 'אתר הקליניקה', channel: 'website', treatment: '—', status: '', spend: 0, leads: 12, booked: 4, arrived: 3, paid: 1, rev: 0, revNull: true, src: true },
      { key: 'missed_call', name: 'שיחה שלא נענתה', channel: 'missed_call', treatment: '—', status: '', spend: 0, leads: 10, booked: 3, arrived: 2, paid: 0, rev: 0, revNull: true, src: true },
      { key: 'medreviews', name: 'MedReviews', channel: 'medreviews', treatment: '—', status: '', spend: 0, leads: 7, booked: 1, arrived: 0, paid: 0, rev: 0, revNull: true, src: true },
    ],
    treatments: ['פייסטייט', 'מורפיאוס 8', 'בוטוקס', 'השתלת שיער'],
  };
  const ATT_CATS = [
    { key: 'no_response', title: 'חדשים שלא קיבלו מענה', color: 'var(--ac-red)', exit: 'יוצא מהרשימה כשהצוות או המערכת עונים', items: [
      { id: '48213', ch: 'מטא · וואטסאפ', tr: 'פייסטייט', w: 'לפני 3 שעות', wh: 3 },
      { id: '48209', ch: 'טופס מטא', tr: 'מורפיאוס 8', w: 'לפני 5 שעות', wh: 5 },
      { id: '48198', ch: 'אורגני', tr: '—', w: 'לפני 40 דקות', wh: .7 },
      { id: '48195', ch: 'מטא · וואטסאפ', tr: 'בוטוקס', w: 'לפני 6 שעות', wh: 6 },
      { id: '48190', ch: 'אתר', tr: '—', w: 'לפני שעתיים', wh: 2 },
      { id: '48187', ch: 'MedReviews', tr: '—', w: 'אתמול', wh: 26 },
      { id: '48181', ch: 'מטא · וואטסאפ', tr: 'פייסטייט', w: 'לפני 50 דקות', wh: .8 },
    ] },
    { key: 'book_click', title: 'לחצו "לקבוע ייעוץ" ולא נקבע תור', color: 'var(--ac-orange)', exit: 'יוצא מהרשימה כשנקבע תור ביומן', items: [
      { id: '48211', ch: 'מטא · וואטסאפ', tr: 'מורפיאוס 8', w: 'לפני 40 דקות', wh: .7 },
      { id: '48205', ch: 'אורגני', tr: 'השתלת שיער', w: 'לפני שעתיים', wh: 2 },
      { id: '48199', ch: 'מטא · וואטסאפ', tr: 'פייסטייט', w: 'אתמול', wh: 22 },
      { id: '48193', ch: 'אתר', tr: '—', w: 'לפני 3 שעות', wh: 3 },
    ] },
    { key: 'reschedule', title: 'בקשות שינוי או ביטול תור', color: 'var(--ac-blue)', exit: 'יוצא מהרשימה כשהתור עודכן ביומן', items: [
      { id: '48207', ch: '—', tr: 'תור ביום ג׳ 10:30', w: 'לפני שעה', wh: 1 },
      { id: '48196', ch: '—', tr: 'תור ביום ה׳ 16:00', w: 'לפני 3 שעות', wh: 3 },
      { id: '48188', ch: '—', tr: 'תור מחר 09:00', w: 'אתמול', wh: 20 },
    ] },
    { key: 'site_inquiry', title: 'פניות מהאתר בבדיקה ידנית', color: 'var(--ac-purple)', exit: 'יוצא מהרשימה כשהפנייה מאומתת או נקלטת', items: [
      { id: '48203', ch: 'אתר', tr: 'שם לא תואם כרטיס קיים', w: 'לפני שעתיים', wh: 2 },
      { id: '48191', ch: 'אתר', tr: 'שני כרטיסים לאותו מספר', w: 'לפני 5 שעות', wh: 5 },
    ] },
  ];
  const ATTN_TOTAL = () => ATT_CATS.reduce((a, c) => a + c.items.length, 0);
  const TPLS = [
    { name: 'אישור פנייה מהאתר – נוסח 2', trigger: 'פניית אתר חדשה', sent: 74, replied: 31, booked: 9, optout: 0, cost: 133 },
    { name: 'פולואפ לליד אחרי 24 שעות', trigger: 'ליד מושהה ללא מענה 24 שעות', sent: 64, replied: 18, booked: 7, optout: 1, cost: 109 },
    { name: 'שיחה שלא נענתה', trigger: 'שיחה שלא נענתה', sent: 41, replied: 12, booked: 3, optout: 0, cost: 74 },
    { name: 'הנחיות לפני טיפול פייסטייט', trigger: '24 שעות לפני תור', sent: 22, replied: 6, booked: null, optout: 0, cost: 40 },
    { name: 'תזכורת תור – נוסח ג׳', trigger: 'יום לפני התור', sent: 9, replied: 4, booked: 2, optout: 0, cost: 16 },
  ];
  const SRCS = [
    { name: 'יומן ותשלומים (Easybizy)', status: 'פעיל', meta: 'עודכן לפני 2 דקות' },
    { name: 'וואטסאפ', status: 'פעיל', meta: 'עודכן לפני דקה' },
    { name: 'פרסום מטא', status: 'פעיל', meta: 'עודכן לפני שעה' },
    { name: 'שיחות שלא נענו', status: 'פעיל', meta: 'אתמול 18:42' },
    { name: 'אתר הקליניקה', status: 'פעיל', meta: 'עודכן לפני 4 שעות' },
    { name: 'MedReviews', status: 'פעיל', meta: 'עודכן לפני יומיים' },
    { name: 'שיוך כפתור וואטסאפ באתר', status: 'בתצוגה מקדימה', meta: 'אירוע אחרון לפני שעה' },
    { name: 'פרסום גוגל', status: 'טרם חובר', meta: '—' },
  ];
  const RESP = { buckets: [['תוך 5 דקות', 41, 'var(--ac-green)'], ['5–30 דקות', 33, 'var(--ac-olive)'], ['30 דקות – שעתיים', 17, 'var(--ac-orange)'], ['מעל שעתיים', 9, 'var(--ac-red)']], median: '12 דקות' };

  const curPeriod = () => (state.q && state.q.get('p')) || 'month';
  const pname = (p) => (CPERIODS.find(([k]) => k === p) || [])[1] || 'החודש';
  function periodUrl(p) {
    const [path, qs] = (location.hash || '#/').split('?');
    const q = new URLSearchParams(qs || '');
    if (p === 'month') q.delete('p'); else q.set('p', p);
    const s = q.toString();
    return path + (s ? '?' + s : '');
  }
  const VER = () => document.querySelector('meta[name="app-ver"]')?.content || '';
  function clinicHead(title, sub) {
    return `<div class="page-head"><h1>${title}</h1><span class="badge yellow">נתוני דמו</span><span class="badge" style="background:var(--gray-soft);color:var(--muted);font-weight:600">גרסה ${VER()}</span></div>${sub ? `<div class="cell-sub" style="margin:2px 0 14px">${sub}</div>` : ''}`;
  }
  const FCOLORS = ['var(--ac-blue)', 'var(--ac-orange)', 'var(--ac-olive)', 'var(--ac-green)'];
  function funnelBars(st) {
    const first = st[0][1] || 1;
    let o = '<div class="fb">';
    st.forEach(([nm, v], i) => {
      const w = Math.max(3, Math.round(v / first * 100));
      if (i) o += `<div class="fb-conv"><b class="num">${Math.round(v / (st[i - 1][1] || 1) * 100)}%</b> המרה · <span class="num">${Math.round(v / first * 100)}%</span> מההתחלה</div>`;
      o += `<div class="fb-row"><span class="fb-n">${nm}</span><div class="fb-track"><div class="fb-bar" style="width:${w}%;background:${FCOLORS[i]}"><b class="num">${v}</b></div></div></div>`;
    });
    o += `<div class="fb-e2e">המרה מקצה לקצה: <b class="num">${Math.round(st[3][1] / first * 100)}%</b></div></div>`;
    return o;
  }
  function clinicDonut(chans) {
    const pal = ['var(--pal0)', 'var(--pal1)', 'var(--pal2)', 'var(--pal3)', 'var(--pal4)', 'var(--ac-cyan)'];
    const tot = chans.reduce((a, c) => a + c.leads, 0) || 1;
    let acc = 0;
    const segs = chans.map((c, i) => { const f = acc / tot * 360; acc += c.leads; return `${pal[i % 6]} ${f}deg ${acc / tot * 360}deg`; }).join(', ');
    return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${segs})"><div class="hole"><div><b class="num">${tot}</b><small>לידים</small></div></div></div>
      <div class="donut-legend">${chans.map((c, i) => `<a class="dl-row" href="#/channels?channel=${c.key}"><span class="dotk" style="background:${pal[i % 6]}"></span><span class="dl-name">${c.name}</span><b class="num">${c.leads} · ${Math.round(c.leads / tot * 100)}%</b></a>`).join('')}</div></div>`;
  }
  function scaledChannels(p) {
    const f = PSCALE[p] || 1, r = (n) => Math.round(n * f);
    return CD.channels.map(c => ({ ...c, leads: r(c.leads), booked: r(c.booked), arrived: r(c.arrived), paid: r(c.paid), spend: r(c.spend) }));
  }
  function scaledCampaigns(p) {
    const f = PSCALE[p] || 1, r = (n) => Math.round(n * f);
    return CD.campaigns.map(c => ({ ...c, spend: r(c.spend), leads: r(c.leads), booked: r(c.booked), arrived: r(c.arrived), paid: r(c.paid), rev: r(c.rev) }));
  }
  const chanName = (key) => (CD.channels.find(c => c.key === key) || {}).name || key;

  function viewClinic(screen, param) {
    clearInterval(state.convoTimer);
    shell('clinic', '<div id="clinic-body"></div>', null, 'clinic', screen);
    const el = document.getElementById('clinic-body');
    ({ overview: clinicOverview, attention: clinicAttention, channels: clinicChannels, campaign: clinicCampaign, messages: clinicMessages, status: clinicStatus }[screen] || clinicOverview)(el, param);
  }

  function clinic404() {
    clearInterval(state.convoTimer);
    shell('clinic', `<div class="card" style="margin-top:24px;text-align:center;padding:40px"><h3>הדף לא נמצא</h3><p class="cell-sub">הקישור ישן — הדשבורד שודרג ומבנה הדפים השתנה.</p><p style="margin-top:14px"><a class="btn" href="#/" style="text-decoration:none">לסקירה הכללית</a></p></div>`, null, 'clinic', '');
  }

  function overviewChart(p) {
    const now = new Date();
    const dstr = (d) => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
    const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
    let values, labels, title;
    if (p === 'today') {
      values = [0, 1, 0, 2, 1, 3, 2, 4, 3, 2, 5, 3, 4, 2];
      labels = values.map((_, i) => (i % 2 === 0 ? (8 + i) + ':00' : ''));
      title = 'לידים — היום לפי שעות';
    } else if (p === 'week') {
      values = [8, 6, 11, 9, 5, 7, 9];
      labels = values.map((_, i) => dstr(ago(6 - i)));
      title = 'לידים — 7 ימים אחרונים';
    } else if (p === 'q90') {
      values = [32, 38, 35, 41, 39, 44, 47, 43, 50, 46, 52, 49];
      labels = values.map((_, i) => (i % 2 === 0 ? dstr(ago((11 - i) * 7)) : ''));
      title = 'לידים — 12 שבועות אחרונים (שבועי)';
    } else if (p === 'prevmonth') {
      values = [5, 7, 4, 8, 6, 9, 7, 5, 8, 6, 4, 7, 8, 6];
      const base = now.getDate() + 13;
      labels = values.map((_, i) => (i % 2 === 0 ? dstr(ago(base - i)) : ''));
      title = 'לידים — החודש הקודם';
    } else {
      values = p === 'custom' ? [4, 6, 3, 7, 5, 8, 6, 4, 5, 7, 3, 6, 5, 4] : [6, 8, 5, 9, 7, 4, 10, 8, 6, 11, 9, 5, 7, 9];
      labels = values.map((_, i) => (i % 2 === 0 ? dstr(ago(13 - i)) : ''));
      title = p === 'custom' ? 'לידים — בטווח שנבחר' : 'לידים — 14 ימים אחרונים';
    }
    return { chart: c2chart(values, { labels, tip: (i) => `${values[i]} לידים` }), title };
  }

  function clinicOverview(el) {
    const p = curPeriod();
    const f = PSCALE[p] || 1, r = (n) => Math.round(n * f);
    const dl = PDELTAS[p] || PDELTAS.month;
    const { chart, title } = overviewChart(p);
    const kpi = (label, value, sub, up, i, link) => `<${link ? `a href="${link}"` : 'div'} class="stat kpi has-tip kpi-link" data-tip="${TIP[label.replace(/ · .*/, '')] || ''}" tabindex="0" style="--ac:${['var(--ac-blue)', 'var(--ac-blue)', 'var(--ac-orange)', 'var(--ac-green)', 'var(--ac-purple)', 'var(--ac-red)'][i]}"><div class="s-label">${label}<span class="info-i">i</span></div><div class="s-value num">${value}</div><div class="s-sub" style="color:${up ? 'var(--mint-ink)' : 'var(--red)'}">${sub}</div></${link ? 'a' : 'div'}>`;
    const chans = scaledChannels(p);
    const attOldest = (c) => c.items.reduce((a, it) => it.wh > a.wh ? it : a, c.items[0]);
    el.innerHTML = clinicHead('סקירה כללית', `${CLINIC.updatedAgo} · הדגמה בלבד — נתונים לצורך הצגה בלבד, אין חיבור לנתוני הקליניקה`) + `
      <div class="card att-hero" style="margin:0 0 14px">
        <div class="att-hero-head"><h3 style="margin:0">דורש טיפול עכשיו</h3><span class="att-hero-total num">${ATTN_TOTAL()}</span></div>
        <div class="att-hero-cats">
          ${ATT_CATS.map(c => `<a class="att-hero-cat" href="#/attention/${c.key}" style="--ac:${c.color}">
            <div class="n num">${c.items.length}</div><div class="t">${c.title}</div><div class="w">הוותיק: ${attOldest(c).w}</div>
          </a>`).join('')}
        </div>
      </div>
      <div class="dash-grid">
        ${kpi('לידים היום', 9, '+2 מול אתמול', true, 0, '#/channels?p=today')}
        ${kpi('לידים · ' + pname(p), r(184), dl.leads, true, 1)}
        ${kpi('תורים שנקבעו', r(62), dl.booked, true, 2)}
        ${kpi('מטופלים משלמים חדשים', r(23), dl.paying, p === 'prevmonth', 3)}
        ${kpi('הכנסות', ils(r(CD.revenue)), 'מתוכן משויכות לפרסום: ' + ils(r(96200)), true, 4)}
        ${kpi('הוצאת פרסום', ils(r(12330)), 'החזר ×7.8 על ההוצאה', true, 5)}
      </div>
      ${p === 'custom' ? `<div class="cell-sub" style="margin:0 0 12px"><span class="range-box"><input type="date" id="rng-from" value="2026-11-01"> עד <input type="date" id="rng-to" value="2026-11-24"></span></div>` : ''}
      <div class="dash-2col">
        <div class="card" style="margin:0"><h3>${title}</h3><div dir="ltr">${chart}</div></div>
        <div class="card" style="margin:0"><h3>לידים לפי ערוץ</h3>
          ${clinicDonut(chans)}
          <div class="tbl-wrap"><table class="tbl tbl-rows">
            <thead><tr><th>ערוץ</th><th>לידים</th><th>נקבעו תורים</th></tr></thead>
            <tbody>${chans.map(c => `<tr data-chlink="${c.key}" style="cursor:pointer"><td data-h="ערוץ"><b>${c.name}</b></td><td data-h="לידים" class="num">${c.leads}</td><td data-h="נקבעו" class="num">${c.booked} · ${Math.round(c.booked / (c.leads || 1) * 100)}%</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
      <a class="status-mini" href="#/status"><span class="sdot ok"></span> 6 מקורות פעילים · פרסום גוגל טרם חובר · ${CLINIC.updatedAgo}</a>
      <div class="alert-strip" style="margin-top:10px"><span class="as-ico">⚠</span><span><b>נתונים חלקיים:</b> פרסום גוגל טרם חובר — ההוצאה והלידים מגוגל אינם נכללים כרגע בדוחות. שאר המקורות מלאים.</span></div>`;
    el.querySelectorAll('[data-chlink]').forEach(tr => tr.onclick = () => { location.hash = '#/channels?channel=' + tr.dataset.chlink; });
  }

  function clinicAttention(el, cat) {
    const cats = cat ? ATT_CATS.filter(c => c.key === cat) : ATT_CATS;
    const wc = (wh) => wh < 1 ? 'var(--mint-ink)' : wh < 4 ? 'var(--ac-orange)' : 'var(--red)';
    el.innerHTML = clinicHead('דורש טיפול', `מתרענן אוטומטית כל 60 שניות · בדשבורד לא נשמרים שמות או טלפונים — מזהה בלבד`) + `
      ${cat ? `<div style="margin-bottom:12px"><a href="#/attention" style="color:var(--green);font-weight:600">← כל הקטגוריות</a></div>` : ''}
      ${cats.map(c => `<div class="card att-cat" style="--ac:${c.color};margin:0 0 12px">
        <div class="att-cat-head"><h3 style="margin:0">${c.title}</h3><span class="att-badge num" style="background:${c.color}">${c.items.length}</span><span class="cell-sub">${c.exit}</span></div>
        ${c.items.map(it => `<div class="att-row2">
          <bdi class="att-id num">ליד #${it.id}</bdi>
          <span class="badge blue">${it.ch}</span>
          ${it.tr !== '—' ? `<span class="badge">${it.tr}</span>` : ''}
          <span class="att-wait num" style="color:${wc(it.wh)}">ממתין ${it.w}</span>
          <button class="att-ebz" data-ebz>פתח ב-Easybizy ←</button>
        </div>`).join('')}
      </div>`).join('')}
      <div class="guide">במערכת המחוברת הרשימה מתעדכנת ישירות ממקורות הנתונים; פרטי מטופלים לא נשמרים בדשבורד.</div>`;
    el.querySelectorAll('[data-ebz]').forEach(b => b.onclick = () => toast('קישור לדוגמה — בגרסה המחוברת נפתח כרטיס הליד ב-Easybizy'));
  }

  function clinicChannels(el) {
    const p = curPeriod();
    const chans = scaledChannels(p);
    const camps = scaledCampaigns(p);
    const selCh = ((state.q.get('channel')) || '').split(',').filter(Boolean);
    const selTr = state.q.get('treatment') || '';
    const tot = {
      spend: chans.reduce((a, c) => a + c.spend, 0), leads: chans.reduce((a, c) => a + c.leads, 0),
      booked: chans.reduce((a, c) => a + c.booked, 0), arrived: chans.reduce((a, c) => a + c.arrived, 0),
      paid: chans.reduce((a, c) => a + c.paid, 0), revAttr: camps.reduce((a, c) => a + c.rev, 0),
    };
    const roas = tot.spend ? '×' + (tot.revAttr / tot.spend).toFixed(1) : '—';
    const counter = (label, value, color) => `<div class="att-counter has-tip" data-tip="${TIP[label] || ''}" tabindex="0" style="--ac:${color}"><div class="ac-num num">${value}</div><div class="ac-label">${label}<span class="info-i">i</span></div></div>`;
    const chUrl = (chs, tr) => {
      const q = new URLSearchParams();
      if (chs.length) q.set('channel', chs.join(','));
      if (tr) q.set('treatment', tr);
      if (p !== 'month') q.set('p', p);
      const s = q.toString();
      return '#/channels' + (s ? '?' + s : '');
    };
    const one = selCh.length === 1 ? chans.find(c => c.key === selCh[0]) : null;
    const fs = one || tot;
    const visCamps = camps.filter(c => (!selCh.length || selCh.includes(c.channel)) && (!selTr || c.treatment === selTr));
    const sum = (f2) => visCamps.reduce((a, c) => a + c[f2], 0);
    const campRow = (c) => {
      const cpl = c.spend && c.leads ? ils(Math.round(c.spend / c.leads)) : '—';
      const rroas = c.spend ? '×' + (c.rev / c.spend).toFixed(1) : '—';
      return `<tr data-camp="${c.key}" style="cursor:pointer">
        <td data-h="קמפיין"><b>${c.name}</b>${c.unmapped ? ' <span class="badge yellow">ממתין למיפוי</span>' : ''}</td>
        <td data-h="ערוץ"><span class="badge blue">${chanName(c.channel)}</span></td>
        <td data-h="טיפול">${c.treatment}</td>
        <td data-h="הוצאה" class="num">${c.spend ? ils(c.spend) : '—'}</td>
        <td data-h="לידים" class="num">${c.leads}</td>
        <td data-h="עלות לליד" class="num">${cpl}</td>
        <td data-h="נקבעו" class="num">${c.booked}</td>
        <td data-h="הגיעו" class="num">${c.arrived}</td>
        <td data-h="שילמו" class="num">${c.paid}</td>
        <td data-h="הכנסה משויכת" class="num">${c.revNull ? '—' : ils(c.rev)}</td>
        <td data-h="החזר" class="num">${rroas}</td>
      </tr>`;
    };
    const respBar = `<div class="rtbar">${RESP.buckets.map(([l, v, c]) => `<span class="rtseg" style="width:${v}%;background:${c}" data-tip="${l}: ${v}%"></span>`).join('')}</div>`;
    el.innerHTML = clinicHead('ערוצים וקמפיינים', `תקופה: ${pname(p)} · בסיס מדדי קוהורט: לפי תאריך ליד · בסיס מדדי פעילות: לפי תאריך אירוע`) + `
      <div class="att-counters c6">
        ${counter('הוצאה', ils(tot.spend), 'var(--ac-red)')}
        ${counter('לידים', tot.leads, 'var(--ac-blue)')}
        ${counter('תורים שנקבעו', tot.booked, 'var(--ac-orange)')}
        ${counter('מטופלים משלמים חדשים', tot.paid, 'var(--ac-green)')}
        ${counter('הכנסות משויכות', ils(tot.revAttr), 'var(--ac-purple)')}
        ${counter('החזר על ההוצאה', roas, 'var(--green)')}
      </div>
      <div class="card" style="margin:0 0 12px">
        <div class="filt-row"><span class="filt-l">ערוץ:</span>
          ${CD.channels.map(c => `<a class="board-tab ${selCh.includes(c.key) ? 'active' : ''}" href="${chUrl(selCh.includes(c.key) ? selCh.filter(k => k !== c.key) : [...selCh, c.key], selTr)}">${c.name}</a>`).join('')}
          ${selCh.length ? `<a class="board-tab" href="${chUrl([], selTr)}" style="opacity:.7">נקה</a>` : ''}
        </div>
        <div class="filt-row"><span class="filt-l">טיפול:</span>
          ${CD.treatments.map(t => `<a class="board-tab ${selTr === t ? 'active' : ''}" href="${chUrl(selCh, selTr === t ? '' : t)}">${t}</a>`).join('')}
          ${selTr ? `<a class="board-tab" href="${chUrl(selCh, '')}" style="opacity:.7">נקה</a>` : ''}
        </div>
      </div>
      <div class="card" style="margin:0 0 12px"><h3>המשפך${one ? ' — ' + one.name : ' — כל הערוצים'} <span class="chip">לפי תאריך ליד</span></h3>
        ${funnelBars([['לידים', fs.leads], ['קבעו תור', fs.booked], ['הגיעו', fs.arrived], ['שילמו', fs.paid]])}
        <div class="cell-sub" style="margin-top:8px">⚠ חלק מהקוהורט צעיר משבועיים — אחוזי ההמרה עשויים להשתנות ככל שהקוהורט מתבגר.</div>
      </div>
      <div class="card" style="margin:0 0 12px"><h3>משפך לפי ערוץ <span class="chip">לפי תאריך ליד</span></h3>
        <div class="tbl-wrap"><table class="tbl tbl-rows">
          <thead><tr><th>ערוץ</th><th>לידים</th><th>נקבעו %</th><th>הגיעו %</th><th>שילמו %</th><th>מקצה לקצה</th><th>עלות למטופל משלם</th><th>מול תקופה קודמת</th></tr></thead>
          <tbody>${chans.map(c => {
            const pc = (a, b) => Math.round(a / (b || 1) * 100) + '%';
            const cpp = c.spend && c.paid ? ils(Math.round(c.spend / c.paid)) : (c.paid ? 'ללא עלות' : '—');
            return `<tr><td data-h="ערוץ"><b>${c.name}</b></td><td data-h="לידים" class="num">${c.leads}</td>
              <td data-h="נקבעו" class="num">${pc(c.booked, c.leads)}</td><td data-h="הגיעו" class="num">${pc(c.arrived, c.booked)}</td>
              <td data-h="שילמו" class="num">${pc(c.paid, c.arrived)}</td><td data-h="מקצה לקצה"><b class="num">${pc(c.paid, c.leads)}</b></td>
              <td data-h="עלות למטופל" class="num">${cpp}</td>
              <td data-h="מול קודמת"><span style="color:${c.up ? 'var(--mint-ink)' : 'var(--red)'}">${c.delta}</span></td></tr>`;
          }).join('')}</tbody>
        </table></div>
        <div class="cell-sub" style="margin-top:8px">איזה ערוץ מביא ואיפה הוא נוזל. עלות למטופל משלם = הוצאת הערוץ חלקי מטופלים ששילמו.</div>
      </div>
      <div class="card" style="margin:0 0 12px"><h3>קמפיינים <span class="chip">הכנסה: משויכת לפרסום בלבד</span></h3>
        <div class="tbl-wrap"><table class="tbl tbl-rows">
          <thead><tr><th>קמפיין</th><th>ערוץ</th><th>טיפול</th><th>הוצאה</th><th>לידים</th><th>עלות לליד</th><th>נקבעו</th><th>הגיעו</th><th>שילמו</th><th>הכנסה משויכת</th><th>החזר</th></tr></thead>
          <tbody>${visCamps.map(campRow).join('')}
            <tr class="sum-row"><td data-h="קמפיין"><b>סה״כ (${visCamps.length})</b></td><td></td><td></td>
              <td data-h="הוצאה" class="num">${ils(sum('spend'))}</td><td data-h="לידים" class="num">${sum('leads')}</td>
              <td data-h="עלות לליד" class="num">${sum('spend') && sum('leads') ? ils(Math.round(sum('spend') / sum('leads'))) : '—'}</td>
              <td data-h="נקבעו" class="num">${sum('booked')}</td><td data-h="הגיעו" class="num">${sum('arrived')}</td>
              <td data-h="שילמו" class="num">${sum('paid')}</td><td data-h="הכנסה משויכת" class="num">${ils(sum('rev'))}</td>
              <td data-h="החזר" class="num">${sum('spend') ? '×' + (sum('rev') / sum('spend')).toFixed(1) : '—'}</td></tr>
          </tbody>
        </table></div>
        <div class="cell-sub" style="margin-top:8px">לחיצה על שורה פותחת זום מלא על הקמפיין. שורת הסיכום זהה לכרטיסי ה-KPI למעלה.</div>
      </div>
      <div class="card" style="margin:0"><h3>זמן מענה ראשון <span class="chip">שעון מלא</span></h3>
        ${respBar}
        <div class="chart-legend" style="margin-top:8px">${RESP.buckets.map(([l, v, c]) => `<span><span class="dotk" style="background:${c}"></span>${l} · <b class="num">${v}%</b></span>`).join('')}</div>
        <div class="cell-sub" style="margin-top:8px">חציון זמן מענה: <b class="num">${RESP.median}</b> · מענה מהיר מכפיל את הסיכוי לקביעת תור — הסיבה שאוטומציית המענה הראשון קריטית.</div>
      </div>`;
    el.querySelectorAll('[data-camp]').forEach(tr => tr.onclick = () => { location.hash = '#/channels/campaign/' + tr.dataset.camp + (p !== 'month' ? '?p=' + p : ''); });
  }

  function clinicCampaign(el, key) {
    const p = curPeriod();
    const c = scaledCampaigns(p).find(x => x.key === key) || scaledCampaigns(p)[0];
    const cpl = c.spend && c.leads ? ils(Math.round(c.spend / c.leads)) : '—';
    const cpp = c.spend && c.paid ? ils(Math.round(c.spend / c.paid)) : (c.paid ? 'ללא עלות' : '—');
    const roas = c.spend ? '×' + (c.rev / c.spend).toFixed(1) : '—';
    const kh = key.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const trend = Array.from({ length: 14 }, (_, i) => Math.max(0, Math.round(c.leads / 14 * (0.55 + ((i * 7 + kh) % 5) * 0.22))));
    const now = new Date();
    const dstr = (d) => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
    const labels = trend.map((_, i) => { const d = new Date(now); d.setDate(d.getDate() - (13 - i)); return i % 2 === 0 ? dstr(d) : ''; });
    const tile = (label, value, color) => `<div class="msg-tile has-tip" data-tip="${TIP[label] || ''}" tabindex="0" style="--ac:${color}"><div class="msg-num num" style="font-size:20px">${value}</div><div class="msg-label">${label}<span class="info-i">i</span></div></div>`;
    el.innerHTML = clinicHead(c.name, '') + `
      <div style="margin-bottom:12px"><a href="#/channels${p !== 'month' ? '?p=' + p : ''}" style="color:var(--green);font-weight:600">← חזרה לערוצים וקמפיינים</a></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <span class="badge blue">${chanName(c.channel)}</span>
        ${c.treatment !== '—' ? `<span class="badge">${c.treatment}</span>` : ''}
        ${c.status ? `<span class="badge ${c.status === 'פעיל' ? 'green' : ''}">${c.status}</span>` : ''}
        ${c.unmapped ? '<span class="badge yellow">ממתין למיפוי — נספר בערוץ אבל לא בקמפיין</span>' : ''}
        <span class="cell-sub">תקופה: ${pname(p)}</span>
      </div>
      <div class="msg-stats c4" style="margin:0 0 12px">
        ${tile('הוצאה', c.spend ? ils(c.spend) : '—', 'var(--ac-red)')}
        ${tile('לידים', c.leads, 'var(--ac-blue)')}
        ${tile('עלות לליד', cpl, 'var(--ac-cyan)')}
        ${tile('תורים שנקבעו', c.booked, 'var(--ac-orange)')}
        ${tile('הגיעו', c.arrived, 'var(--ac-olive)')}
        ${tile('מטופלים משלמים חדשים', c.paid, 'var(--ac-green)')}
        ${tile('הכנסות משויכות', c.revNull ? '—' : ils(c.rev), 'var(--ac-purple)')}
        ${tile('החזר על ההוצאה', roas, 'var(--green)')}
      </div>
      <div class="cell-sub" style="margin:0 0 12px">עלות למטופל משלם: <b>${cpp}</b></div>
      <div class="dash-2col">
        <div class="card" style="margin:0"><h3>המשפך של הקמפיין <span class="chip">לפי תאריך ליד</span></h3>
          ${funnelBars([['לידים', c.leads], ['קבעו תור', c.booked], ['הגיעו', c.arrived], ['שילמו', c.paid]])}
        </div>
        <div class="card" style="margin:0"><h3>לידים — 14 ימים אחרונים</h3>
          <div dir="ltr">${c2chart(trend, { labels, tip: (i) => `${trend[i]} לידים` })}</div>
          ${c.spend ? `<div class="cell-sub" style="margin-top:8px">הוצאה יומית ממוצעת: <b class="num">${ils(Math.round(c.spend / 30))}</b></div>` : ''}
        </div>
      </div>`;
  }

  function clinicMessages(el) {
    const p = curPeriod();
    const f = PSCALE[p] || 1, r = (n) => Math.round(n * f);
    const rows = TPLS.map(t => ({ ...t, sent: r(t.sent), replied: r(t.replied), booked: t.booked == null ? null : r(t.booked), optout: r(t.optout), cost: r(t.cost) }));
    const sent = rows.reduce((a, t) => a + t.sent, 0), replied = rows.reduce((a, t) => a + t.replied, 0);
    const booked = rows.reduce((a, t) => a + (t.booked || 0), 0), optouts = rows.reduce((a, t) => a + t.optout, 0), cost = rows.reduce((a, t) => a + t.cost, 0);
    const counter = (label, value, color) => `<div class="att-counter has-tip" data-tip="${TIP[label] || ''}" tabindex="0" style="--ac:${color}"><div class="ac-num num">${value}</div><div class="ac-label">${label}<span class="info-i">i</span></div></div>`;
    el.innerHTML = clinicHead('הודעות אוטומטיות', `חלון שליחה: ${CLINIC.followup} · תקופה: ${pname(p)}`) + `
      <div class="att-counters c4">
        ${counter('נשלחו', sent, 'var(--ac-blue)')}
        ${counter('ענו', Math.round(replied / (sent || 1) * 100) + '%', 'var(--ac-green)')}
        ${counter('קבעו תור', booked, 'var(--ac-orange)')}
        ${counter('עלות משוערת', ils(cost), 'var(--ac-purple)')}
      </div>
      <div class="card" style="margin:0 0 12px"><h3>תבניות</h3>
        <div class="tbl-wrap"><table class="tbl tbl-rows">
          <thead><tr><th>תבנית</th><th>טריגר</th><th>נשלחו</th><th>ענו %</th><th>קבעו תור</th><th>הסרות</th><th>עלות (משוער)</th></tr></thead>
          <tbody>${rows.map(t => `<tr>
            <td data-h="תבנית"><b>${t.name}</b></td><td data-h="טריגר"><span class="badge">${t.trigger}</span></td>
            <td data-h="נשלחו" class="num">${t.sent}</td>
            <td data-h="ענו" class="num">${Math.round(t.replied / (t.sent || 1) * 100)}%</td>
            <td data-h="קבעו תור" class="num">${t.booked == null ? '—' : t.booked}</td>
            <td data-h="הסרות" class="num">${t.optout}</td>
            <td data-h="עלות" class="num">${ils(t.cost)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="cell-sub" style="margin-top:8px">עלות משוערת = מנוי חודשי לספק ÷ הודעות, בתוספת תעריף שיחה — הערכה בלבד, מסומנת "משוער" בכל מקום. הסרות: ${optouts} בתקופה.</div>
      </div>
      <div class="card" style="margin:0;opacity:.75"><h3>הודעות לפי סטטוס <span class="badge yellow">בתצוגה מקדימה</span></h3>
        <div class="cell-sub">התבניות מוכנות אך עוד לא משדרות — בחלון השליחה הקרוב (${CLINIC.followup}) <b>היו נשלחות 6 הודעות</b>.</div>
      </div>`;
  }

  function clinicStatus(el) {
    const badge = (s) => s === 'פעיל' ? '<span class="badge green"><span class="dot"></span>פעיל</span>'
      : s === 'בתצוגה מקדימה' ? '<span class="badge yellow">בתצוגה מקדימה</span>'
      : s === 'תקלה' ? '<span class="badge" style="background:var(--red);color:#fff">תקלה</span>' : '<span class="badge">טרם חובר</span>';
    const count = (st) => SRCS.filter(s => s.status === st).length;
    el.innerHTML = clinicHead('סטטוס המערכת', CLINIC.updatedAgo) + `
      <div class="att-counters c4">
        <div class="att-counter" style="--ac:var(--mint-ink)"><div class="ac-num num">${count('פעיל')}</div><div class="ac-label">פעיל</div></div>
        <div class="att-counter" style="--ac:var(--yellow)"><div class="ac-num num">${count('בתצוגה מקדימה')}</div><div class="ac-label">בתצוגה מקדימה</div></div>
        <div class="att-counter" style="--ac:var(--red)"><div class="ac-num num">${count('תקלה')}</div><div class="ac-label">תקלה</div></div>
        <div class="att-counter" style="--ac:var(--muted)"><div class="ac-num num">${count('טרם חובר')}</div><div class="ac-label">טרם חובר</div></div>
      </div>
      <div class="sys-grid">
        ${SRCS.map(s => `<div class="sys-tile"><div class="sys-tile-top"><span class="sys-name">${s.name}</span>${badge(s.status)}</div><span class="sys-meta">${s.meta}</span></div>`).join('')}
      </div>
      <div class="alert-strip" style="margin-top:14px"><span class="as-ico">ℹ</span><span><b>פרסום גוגל טרם חובר</b> — ההוצאה והלידים מגוגל לא נכללים כרגע בדוחות. כל שאר המקורות פעילים והדוחות מלאים לגביהם.</span></div>
      <div class="guide" style="margin-top:10px">במקרה של תקלה תוצג כאן הודעה בשפה פשוטה: מה לא עובד, מה כן עובד, ומה עושים — ללא קודים טכניים.</div>`;
  }



  /* ---- tech zone: password-locked. The tech pages live encrypted in js/tech.enc.json
   *      (AES-256-GCM, key = PBKDF2-SHA256 of the owner's password). Nothing technical is in this file.
   *      The derived key (never the password) is cached in sessionStorage for this tab only. ---- */
  const TECH_PAGES = [['home', 'בקרה'], ['integrations', 'אינטגרציות'], ['mapping', 'מיפוי קיים כיום'], ['fieldmap', 'מיפוי שדות'], ['logs', 'לוגים'], ['freshness', 'טריות נתונים'], ['campaign-map', 'מיפוי קמפיינים'], ['workplan', 'תוכנית עבודה']];

  const TECH_KEY = 'ziv_tech_key_v1';
  let techMod = null, techBlob = null;
  const b64d = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const b64e = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
  async function techFetchBlob() {
    if (!techBlob) {
      const r = await fetch('js/tech.enc.json?v=' + (document.querySelector('meta[name="app-ver"]')?.content || ''), { cache: 'no-store' });
      if (!r.ok) throw new Error('blob_unavailable');
      techBlob = await r.json();
    }
    return techBlob;
  }
  async function techOpen(key) {
    const blob = await techFetchBlob();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, key, b64d(blob.ct));
    const src = new TextDecoder().decode(pt);
    techMod = new Function('ctx', src)({ CD, chanName, esc, shell, state, toast });
    return techMod;
  }
  async function techKeyFromPassword(pw) {
    const blob = await techFetchBlob();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(blob.salt), iterations: blob.iter },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  function techLogout() {
    try { sessionStorage.removeItem(TECH_KEY); } catch {}
    techMod = null;
    location.hash = '#/tech';
    route();
  }
  function techShowModule(page) {
    techMod.view(page);
    const banner = document.querySelector('.tech-banner');
    if (banner && !banner.querySelector('#tech-logout')) {
      banner.insertAdjacentHTML('beforeend', ' <button type="button" class="btn secondary" id="tech-logout" style="margin-inline-start:10px;padding:2px 12px;font-size:12px">יציאה</button>');
      banner.querySelector('#tech-logout').onclick = techLogout;
    }
  }
  function techPrompt(page, msg) {
    clearInterval(state.convoTimer);
    shell('tech', `<div class="tech-banner">⚙ אזור טכני — נעול בסיסמה</div>
      <div class="login-wrap" style="min-height:auto;padding:24px 0"><div class="login-card" dir="rtl">
        <h1>אזור טכני</h1>
        <p>האזור הזה מיועד לעידן בלבד. הזינו סיסמה כדי לפתוח אותו בלשונית הזו.</p>
        <form id="tech-form" autocomplete="off">
          <label class="field"><span>סיסמה</span><input class="input" type="password" id="tech-pw" autocomplete="current-password" required></label>
          <div id="tech-err" class="cell-sub" style="color:var(--red,#c0392b);min-height:18px;margin:-6px 0 10px">${msg ? esc(msg) : ''}</div>
          <button class="btn" type="submit" id="tech-go" style="width:100%;justify-content:center">כניסה</button>
        </form>
      </div></div>`, null, 'tech', page);
    const form = document.getElementById('tech-form'), pw = document.getElementById('tech-pw'), err = document.getElementById('tech-err'), go = document.getElementById('tech-go');
    pw.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      go.disabled = true; err.textContent = 'בודק…';
      try {
        const key = await techKeyFromPassword(pw.value);
        await techOpen(key);
        try { sessionStorage.setItem(TECH_KEY, b64e(await crypto.subtle.exportKey('raw', key))); } catch {}
        techShowModule(page);
      } catch (ex) {
        go.disabled = false; pw.value = ''; pw.focus();
        err.textContent = ex && ex.message === 'blob_unavailable' ? 'לא ניתן לטעון את האזור הטכני כרגע' : 'סיסמה שגויה';
      }
    };
  }
  async function viewTech(page) {
    if (techMod) return techShowModule(page);
    let cached = null;
    try { cached = sessionStorage.getItem(TECH_KEY); } catch {}
    if (cached) {
      try {
        const key = await crypto.subtle.importKey('raw', b64d(cached), { name: 'AES-GCM' }, true, ['decrypt']);
        await techOpen(key);
        return techShowModule(page);
      } catch { try { sessionStorage.removeItem(TECH_KEY); } catch {} }
    }
    techPrompt(page);
  }


  /* ---------------- router ---------------- */
  function route() {
    const raw = location.hash || '#/';
    const [pathPart, qs] = raw.split('?');
    state.q = new URLSearchParams(qs || '');
    const parts = pathPart.split('/');
    const page = parts[1] || '', a = parts[2], b = parts[3];
    /* clinic dashboard (public demo, sample data) — per spec 25.11.2026 */
    if (page === 'board') {
      const map = { '': '#/', overview: '#/', attention: '#/attention', funnel: '#/channels', campaigns: '#/channels', messages: '#/messages', systems: '#/status' };
      const t = map[a || ''];
      if (t) { location.replace(t); return; }
      return clinic404();
    }
    if (!page) return viewClinic('overview');
    if (page === 'attention') return viewClinic('attention', a);
    if (page === 'channels') return a === 'campaign' ? viewClinic('campaign', b) : viewClinic('channels');
    if (page === 'messages') return viewClinic('messages');
    if (page === 'status') return viewClinic('status');
    if (page === 'tech') return viewTech(a || 'home');
    /* console (requires login) */
    if (!Api.isLoggedIn() && pathPart !== '#/login') return viewLogin();
    if (pathPart === '#/login') return viewLogin();
    if (page === 'clients') return viewClients(a === 'new');
    if (page === 'activity') return viewActivityPage();
    if (page === 'client' && a) {
      if (parts[3] === 'builder') return viewBuilder(a, parts[4] || null);
      if (parts[3] === 'automation') return viewAutomation(a, parts[4] || null);
      return viewClient(a, parts[3] || 'dash');
    }
    viewClients();
  }
  window.addEventListener('hashchange', route);
  route();
})();
