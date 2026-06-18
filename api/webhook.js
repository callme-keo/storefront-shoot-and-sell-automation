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
  const slugSafe = String(slug).replace(/"/g, '\\"');
  const records = await base(table)
    .select({ filterByFormula: `{slug} = "${slugSafe}"`, maxRecords: 1 })
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

async function scheduleFollowupEmail(to, pack, idempotencyKey) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    console.warn('[webhook] RESEND_API_KEY ou RESEND_FROM absent — email J+3 non programmé');
    return;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const tplPath = path.join(__dirname, '..', 'emails', 'suivi-j21.html');
  const rawHtml = fs.existsSync(tplPath) ? fs.readFileSync(tplPath, 'utf8') : '';
  // Les images d'email exigent une URL absolue : on injecte le domaine de prod.
  const domain = (process.env.VERCEL_DOMAIN || '').replace(/\/$/, '');
  const html = rawHtml.replace(/\{\{DOMAIN\}\}/g, domain);
  const packLabel = pack === 'hd' ? 'Pack Réseaux + HD' : 'Pack Réseaux';

  // Suivi envoyé 3 semaines après l'achat : le client a eu le temps de publier
  // ses photos et d'en mesurer les retours avant qu'on propose d'aller plus loin.
  const dateSuivi = new Date();
  dateSuivi.setDate(dateSuivi.getDate() + 21);

  await resend.emails.send({
    from: process.env.RESEND_FROM,
    replyTo: process.env.RESEND_REPLY_TO || 'kevin@akowinstudios.com',
    to,
    subject: 'Vos photos',
    html: html || `<p>Bonjour,<br><br>J'espère que votre ${packLabel} vous a plu. N'hésitez pas à revenir vers moi.<br><br>Kévin Cardoso (@callme_keo), Photographe & AKOWIN Studios Founder</p>`,
    scheduledAt: dateSuivi.toISOString(),
  }, idempotencyKey ? { idempotencyKey } : undefined);
}

const handler = async (req, res) => {
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

  // Email J+21 — non bloquant. La clé d'idempotence (id de session) évite
  // un doublon d'email si Stripe rejoue l'événement checkout.session.completed.
  if (email) {
    try {
      await scheduleFollowupEmail(email, pack, `j21-${session.id}`);
      console.log(`[webhook] Email J+21 programmé pour ${email}`);
    } catch (err) {
      console.error('[webhook] Resend error :', err.message);
    }
  }

  return res.json({ received: true });
};

module.exports = handler;

// Stripe vérifie la signature sur le corps brut (non parsé).
// On désactive donc le bodyParser automatique de Vercel, sinon le stream
// est déjà consommé et constructEvent échoue à chaque appel.
module.exports.config = { api: { bodyParser: false } };
