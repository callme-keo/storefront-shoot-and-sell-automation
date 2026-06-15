const Stripe = require('stripe');
const Airtable = require('airtable');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function updateAirtable(slug, pack, email, datePaiement) {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
    .base(process.env.AIRTABLE_BASE_ID);
  const table = process.env.AIRTABLE_TABLE || 'Clients';
  const records = await base(table)
    .select({ filterByFormula: `{slug} = "${slug}"`, maxRecords: 1 })
    .firstPage();
  if (!records.length) {
    console.warn(`[webhook] Aucun enregistrement Airtable pour slug="${slug}"`);
    return;
  }
  await base(table).update(records[0].id, {
    Statut: 'payé',
    'Date paiement': datePaiement,
    'Pack acheté': pack,
    'Email client': email,
  });
}

async function scheduleFollowupEmail(to, pack) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[webhook] RESEND_API_KEY absent — email J+3 non programmé');
    return;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const tplPath = path.join(__dirname, '..', 'emails', 'suivi-j3.html');
  const html = fs.existsSync(tplPath) ? fs.readFileSync(tplPath, 'utf8') : '';
  const packLabel = pack === 'hd' ? 'Pack Réseaux + HD' : 'Pack Réseaux';

  const j3 = new Date();
  j3.setDate(j3.getDate() + 3);

  await resend.emails.send({
    from: process.env.RESEND_FROM || 'Kevin CARDOSO <kevin@ton-domaine.fr>',
    replyTo: process.env.RESEND_REPLY_TO || 'kevin.cardoso@icloud.com',
    to,
    subject: 'Avez-vous pu utiliser vos photos ?',
    html: html || `<p>Bonjour,<br><br>J'espère que votre ${packLabel} vous a plu. N'hésitez pas à revenir vers moi.<br><br>Kevin CARDOSO · @callme_keo</p>`,
    scheduledAt: j3.toISOString(),
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const rawBody = await readRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature invalide :', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true });
  }

  const session = event.data.object;
  const { slug, pack } = session.metadata || {};

  if (!slug || !pack) {
    console.warn('[webhook] Session sans metadata slug/pack :', session.id);
    return res.json({ received: true });
  }

  const email = session.customer_details?.email;
  const today = new Date().toISOString().split('T')[0];

  // Airtable — non bloquant
  try {
    await updateAirtable(slug, pack, email, today);
    console.log(`[webhook] Airtable mis à jour : ${slug} → payé`);
  } catch (err) {
    console.error('[webhook] Airtable error :', err.message);
  }

  // Email J+3 — non bloquant
  if (email) {
    try {
      await scheduleFollowupEmail(email, pack);
      console.log(`[webhook] Email J+3 programmé pour ${email}`);
    } catch (err) {
      console.error('[webhook] Resend error :', err.message);
    }
  }

  return res.json({ received: true });
};
