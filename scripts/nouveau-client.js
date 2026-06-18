#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const simpleGit = require('simple-git');
const Airtable = require('airtable');
const fs = require('fs');
const path = require('path');

const [,, slug, nom] = process.argv;

if (!slug || !nom) {
  console.error('\n❌  Usage : node scripts/nouveau-client.js <slug> "Nom Boutique"\n');
  process.exit(1);
}

if (!process.env.STRIPE_SECRET_KEY || !process.env.VERCEL_DOMAIN) {
  console.error('\n❌  .env manquant ou incomplet — vérifie STRIPE_SECRET_KEY et VERCEL_DOMAIN.\n');
  process.exit(1);
}

const DOMAIN = process.env.VERCEL_DOMAIN.replace(/\/$/, '');
const ROOT = path.join(__dirname, '..');
const clientDir = path.join(ROOT, 'clients', slug);
const git = simpleGit(ROOT);

async function createPaymentLink(packLabel, cents, pack) {
  const product = await Stripe.products.create({
    name: `${packLabel} — ${nom}`,
    metadata: { slug, pack },
  });
  const price = await Stripe.prices.create({
    product: product.id,
    unit_amount: cents,
    currency: 'eur',
  });
  return Stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { slug, pack },
    after_completion: {
      type: 'redirect',
      redirect: {
        url: `${DOMAIN}/delivery?pack=${pack}&slug=${slug}&session_id={CHECKOUT_SESSION_ID}`,
      },
    },
  });
}

async function main() {
  console.log(`\n🔄  Création du client : ${nom} (${slug})…\n`);

  // Dossiers locaux
  for (const dir of ['photos', 'stories', 'posts']) {
    fs.mkdirSync(path.join(clientDir, dir), { recursive: true });
  }

  // Payment Links Stripe
  console.log('💳  Création des liens de paiement Stripe…');
  const [linkReseaux, linkHD] = await Promise.all([
    createPaymentLink('Pack Réseaux', 3900, 'reseaux'),
    createPaymentLink('Pack Réseaux + HD', 4900, 'hd'),
  ]);
  console.log('    ✅ Liens créés');

  // data.json
  const today = new Date().toISOString().split('T')[0];
  const data = {
    slug,
    nom,
    rue: '',
    prix_reseaux: 39,
    prix_hd: 49,
    lien_stripe_reseaux: linkReseaux.url,
    lien_stripe_hd: linkHD.url,
    statut: 'envoyé',
    date_envoi: today,
    date_paiement: null,
    pack_achete: null,
  };
  fs.writeFileSync(path.join(clientDir, 'data.json'), JSON.stringify(data, null, 2));
  console.log('    ✅ data.json généré');

  // Airtable
  if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
    try {
      const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
        .base(process.env.AIRTABLE_BASE_ID);
      await base(process.env.AIRTABLE_TABLE || 'Clients').create({
        slug,
        Nom: nom,
        Statut: 'envoyé',
        'Date envoi': today,
        'Lien Stripe Réseaux': linkReseaux.url,
        'Lien Stripe HD': linkHD.url,
      });
      console.log('    ✅ Airtable mis à jour');
    } catch (e) {
      console.warn(`    ⚠️  Airtable ignoré (table non configurée ?) : ${e.message}`);
    }
  }

  // Git push → Vercel redéploie
  console.log('\n📤  Push sur GitHub…');
  await git.add('.');
  await git.commit(`client: ${slug} — ${nom}`);
  await git.push('origin', 'main');
  console.log('    ✅ Déployé — Vercel en ligne dans ~30 s');

  // Résultat terminal
  const pageUrl = `${DOMAIN}/${slug}`;
  const teaserUrl = `${DOMAIN}/${slug}/free-photo`;

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✅  ${nom.padEnd(50)}  ║
╚══════════════════════════════════════════════════════════╝

📎  Page client :
    ${pageUrl}

🖼️  Photo offerte (à joindre au DM) :
    ${teaserUrl}

💳  Pack Réseaux       (39 €) : ${linkReseaux.url}
💳  Pack Réseaux + HD  (49 €) : ${linkHD.url}

──────────────────────────────────────────────────────────
💬  DM Instagram à copier-coller :
──────────────────────────────────────────────────────────

J'ai adoré votre devanture. Je l'ai photographiée, cette photo est pour vous, libre de droits.

J'ai réuni le reste de la série sur cette page dédiée (déverrouillable à l'achat) :
${pageUrl}

Bien à vous, Kevin (Keo), AKOWIN Studios

──────────────────────────────────────────────────────────
✉️  Email de 1er contact — Objet : J'ai photographié votre devanture
──────────────────────────────────────────────────────────

Bonjour,

Je suis Kevin, photographe chez AKOWIN Studios. En passant devant ${nom}, j'ai adoré votre devanture, je l'ai photographiée. Cette photo est pour vous, libre de droits.

J'ai réuni la photo et le reste de la série sur cette page dédiée (déverrouillable à l'achat) :
${pageUrl}

Bien à vous,
Kevin (Keo), AKOWIN Studios

──────────────────────────────────────────────────────────
`);
}

main().catch(err => {
  console.error(`\n❌  Erreur : ${err.message}\n`);
  process.exit(1);
});
