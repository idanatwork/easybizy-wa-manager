/* API client. Talks to the Cloudflare Worker when configured; otherwise
   serves the demo dataset (mutations kept in memory only). */
const Api = (() => {
  const DEMO_MODE = !CONFIG.WORKER_URL;
  const delay = (ms = 180) => new Promise(r => setTimeout(r, ms));

  // demo in-memory copies so toggles/edits feel real in demo mode
  const d = {
    clients: JSON.parse(JSON.stringify(DEMO.clients)),
    bots: JSON.parse(JSON.stringify(DEMO.bots)),
    events: JSON.parse(JSON.stringify(DEMO.events)),
    templates: JSON.parse(JSON.stringify(DEMO.templates)),
    automations: JSON.parse(JSON.stringify(DEMO.automations)),
    myTemplates: {},   // clientId -> [{id, name}] ("my templates", saved names)
    nextId: 900,
    nextTplId: 1,
  };

  async function request(path, opts = {}) {
    const res = await fetch(CONFIG.WORKER_URL + path, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (sessionStorage.getItem('wa_token') || ''),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      sessionStorage.removeItem('wa_token');
      location.hash = '#/login';
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  return {
    demoMode: DEMO_MODE,

    async login(password) {
      if (DEMO_MODE) { await delay(); sessionStorage.setItem('wa_token', 'demo'); return { ok: true }; }
      const data = await request('/api/login', { method: 'POST', body: { password } });
      sessionStorage.setItem('wa_token', password);
      return data;
    },
    async loginGoogle(credential) {
      const data = await request('/api/auth/google', { method: 'POST', body: { credential } });
      sessionStorage.setItem('wa_token', data.token);
      sessionStorage.setItem('wa_email', data.email || '');
      return data;
    },
    isLoggedIn() { return DEMO_MODE || !!sessionStorage.getItem('wa_token'); },
    logout() { sessionStorage.removeItem('wa_token'); sessionStorage.removeItem('wa_email'); location.hash = '#/login'; },

    async listClients() {
      if (DEMO_MODE) { await delay(); return { clients: d.clients.map(c => ({ ...c, active_bots: d.bots.filter(b => b.client_id === c.id && b.is_live).length })) }; }
      return request('/api/clients');
    },
    async getClient(id) {
      if (DEMO_MODE) { await delay(); return { client: d.clients.find(c => c.id === +id) }; }
      return request('/api/clients/' + id);
    },
    async createClient(body) {
      if (DEMO_MODE) { await delay(); const c = { id: ++d.nextId, connection_status: 'new', events_seen: [], ...body }; d.clients.push(c); return { client: c }; }
      return request('/api/clients', { method: 'POST', body });
    },
    async updateClient(id, body) {
      if (DEMO_MODE) { await delay(); Object.assign(d.clients.find(c => c.id === +id), body); return { ok: true }; }
      return request('/api/clients/' + id, { method: 'PATCH', body });
    },
    async deleteClient(id) {
      if (DEMO_MODE) { await delay(); d.clients = d.clients.filter(c => c.id !== +id); return { ok: true }; }
      return request('/api/clients/' + id, { method: 'DELETE' });
    },
    async testClient(id) {
      if (DEMO_MODE) {
        await delay(600);
        const c = d.clients.find(x => x.id === +id);
        if (c.connection_status === 'key_rejected') return { ok: false, error: 'המפתח נדחה (401) — בדקו key ו-secret' };
        return { ok: true, whatsapp_number: c.whatsapp_number, quality_rating: c.quality_rating || 'GREEN', balance: { used_24h: 38, limit_24h: 1000 } };
      }
      return request('/api/clients/' + id + '/test', { method: 'POST' });
    },
    async testBotSend(clientId, payload) {
      if (DEMO_MODE) { await delay(700); return { ok: true, waiting: true };
      }
      return request('/api/clients/' + clientId + '/testbot', { method: 'POST', body: payload });
    },
    async getTemplates(clientId) {
      if (DEMO_MODE) { await delay(); return { templates: d.templates[clientId] || [] }; }
      return request('/api/clients/' + clientId + '/templates');
    },
    async getMyTemplates(clientId) {
      if (DEMO_MODE) { await delay(); return { templates: d.myTemplates[clientId] || [] }; }
      return request('/api/clients/' + clientId + '/mytemplates');
    },
    async addMyTemplate(clientId, name) {
      if (DEMO_MODE) {
        await delay();
        const list = d.myTemplates[clientId] = d.myTemplates[clientId] || [];
        let t = list.find(x => x.name === name);
        if (!t) { t = { id: d.nextTplId++, name }; list.push(t); }
        return { template: t };
      }
      return request('/api/clients/' + clientId + '/mytemplates', { method: 'POST', body: { name } });
    },
    async deleteMyTemplate(clientId, id) {
      if (DEMO_MODE) { await delay(); d.myTemplates[clientId] = (d.myTemplates[clientId] || []).filter(t => t.id !== +id); return { ok: true }; }
      return request('/api/clients/' + clientId + '/mytemplates', { method: 'DELETE', body: { id } });
    },
    // EasyBizy templates (if the plan allows READ) merged with the client's saved names.
    async listAllTemplates(clientId) {
      const [api, mine] = await Promise.all([
        this.getTemplates(clientId).catch(() => ({ templates: [] })),
        this.getMyTemplates(clientId).catch(() => ({ templates: [] })),
      ]);
      const seen = new Map();
      [...(api.templates || []), ...(mine.templates || [])].forEach(t => {
        if (t && t.name && !seen.has(t.name)) seen.set(t.name, { params: [], language: 'he', ...t });
      });
      return { templates: [...seen.values()] };
    },

    async listBots(clientId) {
      if (DEMO_MODE) { await delay(); return { bots: d.bots.filter(b => b.client_id === +clientId) }; }
      return request('/api/clients/' + clientId + '/bots');
    },
    async getBot(id) {
      if (DEMO_MODE) { await delay(); return { bot: d.bots.find(b => b.id === +id) }; }
      return request('/api/bots/' + id);
    },
    async saveBot(clientId, bot) {
      if (DEMO_MODE) {
        await delay();
        if (bot.id) { Object.assign(d.bots.find(b => b.id === +bot.id), bot); return { bot }; }
        const b = { ...bot, id: ++d.nextId, client_id: +clientId, runs_week: 0 }; d.bots.push(b); return { bot: b };
      }
      return bot.id
        ? request('/api/bots/' + bot.id, { method: 'PATCH', body: bot })
        : request('/api/clients/' + clientId + '/bots', { method: 'POST', body: bot });
    },
    async deleteBot(id) {
      if (DEMO_MODE) { await delay(); d.bots = d.bots.filter(b => b.id !== +id); return { ok: true }; }
      return request('/api/bots/' + id, { method: 'DELETE' });
    },
    async toggleBot(id, isLive) {
      if (DEMO_MODE) { await delay(); d.bots.find(b => b.id === +id).is_live = isLive; return { ok: true }; }
      return request('/api/bots/' + id, { method: 'PATCH', body: { is_live: isLive } });
    },
    async duplicateBot(id, targetClientId) {
      if (DEMO_MODE) {
        await delay();
        const src = d.bots.find(b => b.id === +id);
        const copy = JSON.parse(JSON.stringify(src));
        copy.id = ++d.nextId; copy.client_id = +(targetClientId || src.client_id);
        copy.name = src.name + ' (עותק)'; copy.runs_week = 0; copy.is_live = false;
        d.bots.push(copy); return { bot: copy };
      }
      return request('/api/bots/' + id + '/duplicate', { method: 'POST', body: { client_id: targetClientId } });
    },

    async listAutomations(clientId) {
      if (DEMO_MODE) { await delay(); return { automations: d.automations.filter(a => a.client_id === +clientId) }; }
      return request('/api/clients/' + clientId + '/automations');
    },
    async getAutomation(id) {
      if (DEMO_MODE) { await delay(); return { automation: d.automations.find(a => a.id === +id) }; }
      return request('/api/automations/' + id);
    },
    async saveAutomation(clientId, automation) {
      if (DEMO_MODE) {
        await delay();
        if (automation.id) { Object.assign(d.automations.find(a => a.id === +automation.id), automation); return { automation }; }
        const a = { ...automation, id: ++d.nextId, client_id: +clientId, runs_week: 0, is_active: false, created_at: new Date().toISOString() };
        d.automations.push(a); return { automation: a };
      }
      return automation.id
        ? request('/api/automations/' + automation.id, { method: 'PATCH', body: automation })
        : request('/api/clients/' + clientId + '/automations', { method: 'POST', body: automation });
    },
    async toggleAutomation(id, isActive) {
      if (DEMO_MODE) { await delay(); d.automations.find(a => a.id === +id).is_active = isActive; return { ok: true }; }
      return request('/api/automations/' + id, { method: 'PATCH', body: { is_active: isActive } });
    },
    async deleteAutomation(id) {
      if (DEMO_MODE) { await delay(); d.automations = d.automations.filter(a => a.id !== +id); return { ok: true }; }
      return request('/api/automations/' + id, { method: 'DELETE' });
    },

    async listActivity(params = {}) {
      if (DEMO_MODE) {
        await delay();
        let ev = [...d.events];
        if (params.client_id) ev = ev.filter(e => e.client_id === +params.client_id);
        if (params.result) ev = ev.filter(e => e.result === params.result);
        if (params.event_type) ev = ev.filter(e => e.event_type === params.event_type);
        return { events: ev.sort((a, b) => b.received_at.localeCompare(a.received_at)) };
      }
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request('/api/activity' + (q ? '?' + q : ''));
    },
  };
})();
