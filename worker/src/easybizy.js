/* EasyBizy API client. Docs: https://api.easybizy.net/documentation
   Auth: x-api-key + x-api-secret headers per client account. All datetimes UTC. */
const BASE = 'https://api.easybizy.net';

async function call(client, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': client.api_key,
      'x-api-secret': client.api_secret,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `EasyBizy HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const ping = (client) => call(client, 'GET', '/api/v1/ping');
export const whatsappAccount = (client) => call(client, 'GET', '/api/v1/whatsapp/account');
export const templates = (client, language) =>
  call(client, 'GET', '/api/v1/whatsapp/templates' + (language ? `?language=${language}` : ''));

/* Conversation lookup: window.isOpen / window.remainingSeconds decide free-form vs template. */
export async function conversationWindow(client, phone) {
  const data = await call(client, 'GET', '/api/v1/whatsapp/conversations?phoneNumber=' + encodeURIComponent(phone));
  const convo = data.conversation || data;
  return { isOpen: !!(convo && convo.window && convo.window.isOpen), conversation: convo || null };
}

export const sendMessage = (client, payload) => call(client, 'POST', '/api/v1/whatsapp/messages', payload);

export const sendTemplate = (client, { phone, templateName, language = 'he', params = [], customerName }) =>
  call(client, 'POST', '/api/v1/whatsapp/messages/template', {
    to: { phoneNumber: phone }, templateName, language, params, customerName,
  });

export const createLead = (client, fields) => call(client, 'POST', '/api/v1/leads', fields);
export const createCustomer = (client, fields) => call(client, 'POST', '/api/v1/customers', fields);
export const addLeadActivity = (client, leadId, note) =>
  call(client, 'POST', `/api/v1/leads/${leadId}/activity-info`, { note });
export const createInvoice = (client, fields) => call(client, 'POST', '/api/v1/invoices', fields);
export const createPaymentSession = (client, fields) => call(client, 'POST', '/api/v1/payment-sessions', fields);
export const createGiftCard = (client, fields) => call(client, 'POST', '/api/v1/gift-cards', fields);
export const addCustomerActivity = (client, customerId, note) =>
  call(client, 'POST', `/api/v1/customers/${customerId}/activity-info`, { note });
