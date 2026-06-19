const Airtable = require('airtable');
const crypto = require('crypto');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Resend signe ses webhooks au format Svix. On vérifie la signature sur le
// corps brut, avec protection anti-rejeu (horodatage à ±5 min).
function verifySvix(secret, headers, rawBody) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signed = `${id}.${ts}.${rawBody.toString('utf8')}`;
  const expected = Buffer.from(crypto.createHmac('sha256', key).update(signed).digest('base64'));

  return sigHeader.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expected.length && crypto.timingSafeEqual(sigBuf, expected);
  });
}

async function markAirtable(email, fields) {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !email) return;
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
  const table = process.env.AIRTABLE_TABLE || 'Clients';
  const safe = String(email).replace(/"/g, '\\"');
  const records = await base(table)
    .select({ filterByFormula: `{Email confirmé} = "${safe}"`, maxRecords: 1 })
    .firstPage();
  if (!records.length) {
    console.warn(`[resend] Aucune fiche pour ${email}`);
    return;
  }
  await base(table).update([{ id: records[0].id, fields }], { typecast: true });
}

const handler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const rawBody = await readRawBody(req);

  if (!process.env.RESEND_WEBHOOK_SECRET) {
    console.error('[resend] RESEND_WEBHOOK_SECRET absent');
    return res.status(500).end('Webhook non configuré');
  }
  if (!verifySvix(process.env.RESEND_WEBHOOK_SECRET, req.headers, rawBody)) {
    console.error('[resend] Signature invalide');
    return res.status(400).end('Signature invalide');
  }

  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).end('JSON invalide'); }

  const data = event.data || {};
  const to = Array.isArray(data.to) ? data.to[0] : data.to;

  // On ne traite que l'email de suivi (sujet « Vos photos ») pour ne pas
  // confondre avec d'éventuels autres envois futurs.
  if (data.subject && data.subject !== 'Vos photos') {
    return res.json({ received: true });
  }

  try {
    if (event.type === 'email.sent' || event.type === 'email.delivered') {
      await markAirtable(to, { 'J+21 envoyé': true });
      console.log(`[resend] ${event.type} → J+21 envoyé pour ${to}`);
    } else if (event.type === 'email.opened') {
      await markAirtable(to, { 'J+21 ouvert': true });
      console.log(`[resend] email.opened → J+21 ouvert pour ${to}`);
    }
  } catch (err) {
    console.error('[resend] Airtable error :', err.message);
  }

  return res.json({ received: true });
};

module.exports = handler;

// Signature vérifiée sur le corps brut → on désactive le bodyParser de Vercel.
module.exports.config = { api: { bodyParser: false } };
