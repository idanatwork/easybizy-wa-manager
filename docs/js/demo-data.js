/* Demo dataset used when CONFIG.WORKER_URL is empty.
   Lets the full UI run (and be screenshotted) without a deployed backend. */
const DEMO = (() => {
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60000).toISOString();

  const clients = [
    { id: 1, name: "סטודיו ליאור ביוטי", api_key_masked: "eb_live_••••••••3f9a", api_secret_set: true,
      webhook_token: "c7hq2k9", webhook_secret_set: true, connection_status: "connected",
      whatsapp_number: "+972 52-123-4567", display_name: "Studio Lior Beauty", quality_rating: "GREEN",
      last_checked_at: ago(40), last_event_at: ago(2),
      events_seen: ["customers.create","leads.create","leads.update","appointments.create","appointments.update","invoices.create","whatsapp-messages.received","whatsapp-messages.delivered"],
      notes: "לקוח ראשון, עובד חלק", created_at: ago(60 * 24 * 30) },
    { id: 2, name: "ד״ר חדד רפואת שיניים", api_key_masked: "eb_live_••••••••81bc", api_secret_set: true,
      webhook_token: "m3x81qa", webhook_secret_set: false, connection_status: "connected",
      whatsapp_number: "+972 54-889-2210", display_name: "Dr. Haddad Dental", quality_rating: "YELLOW",
      last_checked_at: ago(180), last_event_at: ago(60),
      events_seen: ["leads.create","appointments.create","appointments.delete","whatsapp-messages.received","whatsapp-messages.delivered","whatsapp-messages.failed"],
      notes: "", created_at: ago(60 * 24 * 21) },
    { id: 3, name: "FitZone Gym", api_key_masked: "eb_live_••••••••aa07", api_secret_set: true,
      webhook_token: "zz2p9xd", webhook_secret_set: false, connection_status: "key_rejected",
      whatsapp_number: null, display_name: null, quality_rating: null,
      last_checked_at: ago(60 * 24 * 3), last_event_at: ago(60 * 24 * 3),
      events_seen: [], notes: "המפתח נדחה — לבקש מהלקוח מפתח חדש", created_at: ago(60 * 24 * 14) },
  ];

  const bots = [
    { id: 1, client_id: 1, name: "עוזר קביעת תור", trigger_type: "keywords", keywords: "תור, appointment, book",
      steps: [
        { type: "buttons", text: "היי {customerName}! מה תרצו?", options: [
            { value: "book", label: "קביעת תור" }, { value: "mine", label: "התורים שלי" }, { value: "talk", label: "דברו איתנו" }],
          branches: {
            book: [
              { type: "question", text: "איזה יום בשבוע מתאים לך?", saveAs: "preferredDay" },
              { type: "easybizy_action", action: "create_lead", note: "רוצה לקבוע תור ביום {preferredDay}" },
            ],
            talk: [ { type: "handoff" } ],
          } },
      ],
      window_closed_template: "booking_start", is_live: true, runs_week: 182, created_at: ago(60 * 24 * 20), updated_at: ago(60 * 3) },
    { id: 2, client_id: 1, name: "אישור תור", trigger_type: "event", event: "appointments.create",
      steps: [
        { type: "template", templateName: "appointment_confirm", language: "he", params: ["{customerName}", "{appointment.startTime}"] },
        { type: "text", text: "נתראה! לביטול או שינוי השיבו כאן" },
      ],
      window_closed_template: "appointment_confirm", is_live: true, runs_week: 64, created_at: ago(60 * 24 * 20), updated_at: ago(60 * 24 * 2) },
    { id: 3, client_id: 1, name: "ברוכים הבאים לליד חדש", trigger_type: "event", event: "leads.create",
      steps: [ { type: "text", text: "היי {lead.name}, תודה שפנית לסטודיו ליאור! נחזור אליך בהקדם" } ],
      window_closed_template: "lead_welcome", is_live: false, runs_week: 0, created_at: ago(60 * 24 * 12), updated_at: ago(60 * 24 * 5) },
    { id: 4, client_id: 1, name: "תפריט גיבוי", trigger_type: "any_message",
      steps: [
        { type: "buttons", text: "איך אפשר לעזור?", options: [
            { value: "hours", label: "שעות פעילות" }, { value: "prices", label: "מחירון" }],
          branches: {
            hours: [ { type: "text", text: "א׳–ה׳ 09:00–19:00, ו׳ 09:00–14:00" } ],
            prices: [ { type: "link", text: "הנה המחירון המלא:", url: "https://example.com/prices", buttonLabel: "למחירון" } ],
          } },
      ],
      window_closed_template: "fallback_menu", is_live: true, runs_week: 311, created_at: ago(60 * 24 * 19), updated_at: ago(60 * 24) },
    { id: 5, client_id: 2, name: "תזכורת תור למרפאה", trigger_type: "event", event: "appointments.create",
      steps: [ { type: "template", templateName: "dental_reminder", language: "he", params: ["{customerName}", "{appointment.startTime}"] } ],
      window_closed_template: "dental_reminder", is_live: true, runs_week: 41, created_at: ago(60 * 24 * 15), updated_at: ago(60 * 24 * 3) },
  ];

  const conversations = [
    { id: 11, client_id: 1, contact_phone: "+972 52-555-0198", customer_name: "דנה כהן",
      bot_id: 1, status: "active", window_open: true, window_left: "21:14", paused: false,
      last_message: "Tapped: Book", last_at: ago(18) },
    { id: 12, client_id: 1, contact_phone: "+972 50-777-1029", customer_name: null,
      bot_id: null, status: "handoff", window_open: true, window_left: "03:02", paused: true,
      last_message: "ממתין לצוות", last_at: ago(185) },
    { id: 13, client_id: 1, contact_phone: "+972 54-333-8871", customer_name: "יוסי לוי",
      bot_id: 2, status: "done", window_open: false, window_left: null, paused: false,
      last_message: "נמסר: אישור תור", last_at: ago(60 * 26) },
  ];

  const messages = {
    11: [
      { id: 101, direction: "inbound", sent_by: "customer", content_type: "text", text: "היי, אפשר לקבוע תור?", delivery_status: "received", at: ago(20) },
      { id: 102, direction: "outbound", sent_by: "bot", content_type: "buttons", text: "היי דנה! מה תרצי?", buttons: ["קביעת תור", "התורים שלי", "דברו איתנו"], delivery_status: "delivered", at: ago(19) },
      { id: 103, direction: "inbound", sent_by: "customer", content_type: "selection", text: "Tapped: קביעת תור", delivery_status: "received", at: ago(18) },
      { id: 104, direction: "outbound", sent_by: "bot", content_type: "text", text: "איזה יום בשבוע מתאים לך?", delivery_status: "delivered", at: ago(18) },
    ],
    12: [
      { id: 105, direction: "inbound", sent_by: "customer", content_type: "text", text: "שלום, אני צריך לדחוף תור דחוף", delivery_status: "received", at: ago(186) },
      { id: 106, direction: "outbound", sent_by: "team", content_type: "text", text: "היי, רגע בודקת מול היומן", delivery_status: "delivered", at: ago(185) },
    ],
    13: [
      { id: 107, direction: "outbound", sent_by: "bot", content_type: "template", template_name: "appointment_confirm", text: "תבנית: appointment_confirm", delivery_status: "delivered", at: ago(60 * 26) },
    ],
  };

  // 30 days of plausible webhook activity per client (statuses only — never message content)
  const events = [];
  let eid = 1000;
  const dayPatterns = { 1: [3,5,2,6,4,7,5,3,6,8,4,5,7,9,6,4,5,8,7,5,6,9,4,6,8,5,7,6,9,11], 2: [1,2,0,1,3,1,2,0,2,1,1,3,2,1,0,2,1,1,2,3,1,2,0,1,2,1,3,2,1,2] };
  const evTypes = ["whatsapp-messages.received", "leads.create", "appointments.create", "whatsapp-messages.received", "appointments.update", "leads.update"];
  for (const [cid, pat] of Object.entries(dayPatterns)) {
    pat.forEach((n, dayIdx) => {
      for (let i = 0; i < n; i++) {
        const failed = (dayIdx * 7 + i * 13 + +cid) % 11 === 0;
        const noBot = !failed && (dayIdx + i) % 4 === 0;
        const et = evTypes[(dayIdx + i * 3) % evTypes.length];
        events.push({
          id: eid++, client_id: +cid, event_type: et,
          result: failed ? "failed" : noBot ? "no_bot" : (et.startsWith("whatsapp") ? "bot_ran" : "automation_ran"),
          details: failed ? "שגיאת שליחה: חלון 24 השעות סגור" : noBot ? "אין בוט שמתאים להודעה" : "הבוט השיב וסיים",
          received_at: new Date(now - dayIdx * 24 * 3600 * 1000 - i * 47 * 60000 - 3600 * 1000).toISOString(),
        });
      }
    });
  }

  const templates = {
    1: [
      { name: "appointment_confirm", language: "he", params: ["שם לקוח", "מועד התור"], example: "היי {{1}}, תורך נקבע ל-{{2}}" },
      { name: "booking_start", language: "he", params: ["שם לקוח"], example: "היי {{1}}, נשמח לקבוע לך תור" },
      { name: "lead_welcome", language: "he", params: ["שם"], example: "היי {{1}}, תודה שפנית!" },
      { name: "fallback_menu", language: "he", params: [], example: "איך אפשר לעזור? בחרו מהתפריט" },
    ],
    2: [
      { name: "dental_reminder", language: "he", params: ["שם לקוח", "מועד"], example: "תזכורת: תור במרפאה ב-{{2}}" },
    ],
  };

  const automations = [
    { id: 301, client_id: 1, name: "ברכה לליד חדש", trigger_event: "leads.create", action: "send_template",
      config: { template_name: "lead_welcome" }, handoff_bot_id: 1, is_active: true, runs_week: 23, created_at: ago(60 * 24 * 10) },
    { id: 302, client_id: 1, name: "אישור תור אוטומטי", trigger_event: "appointments.create", action: "send_template",
      config: { template_name: "appointment_confirm" }, is_active: true, runs_week: 41, created_at: ago(60 * 24 * 9) },
    { id: 303, client_id: 1, name: "קישור תשלום אחרי חשבונית", trigger_event: "invoices.create", action: "payment_link",
      config: { amount: "150", description: "תשלום עבור טיפול" }, is_active: false, runs_week: 0, created_at: ago(60 * 24 * 3) },
    { id: 304, client_id: 2, name: "ליד חדש למרפאה", trigger_event: "leads.create", action: "send_template",
      config: { template_name: "dental_reminder" }, is_active: true, runs_week: 12, created_at: ago(60 * 24 * 6) },
  ];

  return { clients, bots, conversations, messages, events, templates, automations };
})();
