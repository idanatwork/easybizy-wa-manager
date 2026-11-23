/* Small UI helpers. */
const UI = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtTime(iso) {
    if (!iso) return '—';
    const dt = new Date(iso);
    const now = new Date();
    const sameDay = dt.toDateString() === now.toDateString();
    const yest = new Date(now - 864e5).toDateString() === dt.toDateString();
    const hm = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
    if (sameDay) return hm;
    if (yest) return 'אתמול ' + hm;
    return dt.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' }) + ' ' + hm;
  }
  function fmtAgo(iso) {
    if (!iso) return '—';
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso)) / 1000));
    if (s < 60) return 'לפני דקה';
    const m = Math.floor(s / 60);
    if (m < 60) return `לפני ${m} דק׳`;
    const h = Math.floor(m / 60);
    if (h < 24) return `לפני ${h} שע׳`;
    const dd = Math.floor(h / 24);
    return `לפני ${dd} ימים`;
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
  }

  const STATUS = {
    connected: ['green', 'מחובר'],
    key_rejected: ['red', 'מפתח נדחה'],
    new: ['', 'חדש'],
    error: ['red', 'שגיאה'],
  };
  function statusBadge(st) {
    const [cls, label] = STATUS[st] || ['', st || '—'];
    return `<span class="badge ${cls}"><span class="dot"></span>${esc(label)}</span>`;
  }
  function qualityBadge(q) {
    if (!q) return '<span class="badge">—</span>';
    const cls = q === 'GREEN' ? 'green' : q === 'YELLOW' ? 'yellow' : 'red';
    return `<span class="badge ${cls}">${esc(q)}</span>`;
  }
  function resultBadge(r) {
    const map = { bot_ran: ['green', 'בוט רץ'], failed: ['red', 'נכשל'], no_bot: ['', 'אין בוט'], ignored: ['', 'נדילג'] };
    const [cls, label] = map[r] || ['', r];
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function toast(msg, ms = 2600) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function modal(html, onClose) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal">${html}</div>`;
    back.addEventListener('click', (e) => { if (e.target === back) { back.remove(); onClose && onClose(); } });
    document.body.appendChild(back);
    return back;
  }

  function confirmModal(title, text, confirmLabel, onYes) {
    const m = modal(`
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      <div class="modal-actions">
        <button class="btn danger" id="cf-yes">${esc(confirmLabel)}</button>
        <button class="btn secondary" id="cf-no">ביטול</button>
      </div>`);
    m.querySelector('#cf-yes').onclick = () => { m.remove(); onYes(); };
    m.querySelector('#cf-no').onclick = () => m.remove();
  }

  const EVENT_LABELS = {
    'customers.create': 'לקוח נוצר',
    'leads.create': 'ליד נוצר',
    'leads.update': 'ליד עודכן',
    'appointments.create': 'תור נקבע',
    'appointments.update': 'תור שונה',
    'appointments.delete': 'תור בוטל',
    'invoices.create': 'חשבונית הונפקה',
    'whatsapp-messages.received': 'הודעה התקבלה',
    'whatsapp-messages.delivered': 'הודעה נמסרה',
    'whatsapp-messages.failed': 'הודעה נכשלה',
  };
  const ALL_EVENTS = Object.keys(EVENT_LABELS);

  const TRIGGER_LABELS = {
    keywords: 'הודעה עם מילות מפתח',
    any_message: 'כל הודעה נכנסת',
    first_message: 'הודעה ראשונה של לקוח',
    event: 'אירוע EasyBizy',
  };

  const STEP_TYPES = {
    text: 'טקסט',
    buttons: 'כפתורים / רשימה',
    link: 'כפתור קישור',
    file: 'קובץ',
    template: 'תבנית',
    question: 'שאלה',
    condition: 'תנאי',
    easybizy_action: 'פעולת EasyBizy',
    handoff: 'העברה לצוות',
  };

  /* Automation actions: id -> label, guidance shown in the add screen, and config fields. */
  const AUTOMATION_ACTIONS = {
    send_template: {
      label: 'שליחת הודעת תבנית בוואטסאפ',
      guidance: 'לפני שמפעילים את האוטומציה יש להיכנס למערכת EasyBizy וליצור שם את התבנית (מסך תבניות וואטסאפ), ולהמתין לאישורה. בלי תבנית מאושרת ההודעה לא תישלח. אפשר להשתמש ב-{name} ובשדות מהאירוע.',
      fields: [
        { k: 'template_name', label: 'שם התבנית', placeholder: 'lead_welcome', ltr: true, required: true },
      ],
    },
    send_text: {
      label: 'שליחת הודעת טקסט בוואטסאפ',
      guidance: 'הודעת טקסט חופשי נשלחת רק כשחלון 24 השעות מול הלקוח פתוח (אחרי שהלקוח שלח הודעה). לאירועים שהלקוח לא יזם, כמו ליד חדש, בחרו הודעת תבנית.',
      fields: [
        { k: 'text', label: 'תוכן ההודעה', textarea: true, placeholder: 'היי {name}, תודה שפנית אלינו!', required: true },
      ],
    },
    create_lead: {
      label: 'יצירת ליד ב-EasyBizy',
      guidance: 'הליד ייווצר עם השם והטלפון מהאירוע, יחד עם ההערה שתגדירו. אפשר להשתמש ב-{name} ובשדות מהאירוע.',
      fields: [
        { k: 'note', label: 'הערה לליד', placeholder: 'נוצר אוטומטית מאירוע {event}', textarea: true },
      ],
    },
    add_lead_activity: {
      label: 'רישום פעילות בכרטיס ליד',
      guidance: 'רישום פעילות יתווסף לליד שמזוהה מהאירוע (למשל אחרי עדכון ליד).',
      fields: [
        { k: 'note', label: 'תוכן הפעילות', placeholder: 'עודכן סטטוס ל-{status}', textarea: true, required: true },
      ],
    },
    create_customer: {
      label: 'יצירת לקוח ב-EasyBizy',
      guidance: 'הלקוח ייווצר עם השם והטלפון מהאירוע, יחד עם ההערה שתגדירו.',
      fields: [
        { k: 'note', label: 'הערה ללקוח', placeholder: 'נוצר אוטומטית מאירוע {event}', textarea: true },
      ],
    },
    add_customer_activity: {
      label: 'רישום פעילות בכרטיס לקוח',
      guidance: 'רישום פעילות יתווסף ללקוח שמזוהה מהאירוע.',
      fields: [
        { k: 'note', label: 'תוכן הפעילות', placeholder: 'נרשם אוטומטית', textarea: true, required: true },
      ],
    },
    create_invoice: {
      label: 'הפקת חשבונית',
      guidance: 'חשבונית מס קבלה תופק ללקוח שמזוהה מהאירוע, בסכום שתגדירו. ודאו שהגדרות המס ב-EasyBizy תקינות לפני ההפעלה.',
      fields: [
        { k: 'amount', label: 'סכום (₪)', placeholder: '150', ltr: true, required: true },
        { k: 'description', label: 'תיאור', placeholder: 'תשלום עבור שירות' },
      ],
    },
    payment_link: {
      label: 'יצירת קישור תשלום',
      guidance: 'ייווצר קישור תשלום (Payment Session) בסכום שתגדירו. הקישור נשמר בפרטי האירוע ואפשר לשלוח אותו בהמשך בתבנית או בבוט.',
      fields: [
        { k: 'amount', label: 'סכום (₪)', placeholder: '150', ltr: true, required: true },
        { k: 'description', label: 'תיאור', placeholder: 'תשלום עבור שירות' },
      ],
    },
    gift_card: {
      label: 'הנפקת שובר מתנה',
      guidance: 'ייווצר קישור לתשלום שובר מתנה בסכום שתגדירו. השובר עצמו מונפק ב-EasyBizy אחרי התשלום.',
      fields: [
        { k: 'amount', label: 'סכום (₪)', placeholder: '200', ltr: true, required: true },
      ],
    },
  };

  return { esc, fmtTime, fmtAgo, fmtDateTime, statusBadge, qualityBadge, resultBadge, toast, modal, confirmModal, EVENT_LABELS, ALL_EVENTS, TRIGGER_LABELS, STEP_TYPES, AUTOMATION_ACTIONS };
})();
