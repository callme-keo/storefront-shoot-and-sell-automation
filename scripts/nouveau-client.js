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

// Le slug sert de clé partout (R2, URL, download.js qui n'accepte que [a-z0-9-]).
// On refuse tout slug non conforme plutôt que de créer un client silencieusement cassé.
const SLUG_REGEX = /^[a-z0-9-]+$/;
const SLUGS_RESERVES = ['delivery', 'legal-notice', 'assets', 'logo', 'api', 'clients'];
if (!SLUG_REGEX.test(slug)) {
  console.error(`\n❌  Slug invalide : « ${slug} ». Uniquement minuscules, chiffres et tirets (ex : epicerie-du-marche).\n`);
  process.exit(1);
}
if (SLUGS_RESERVES.includes(slug)) {
  console.error(`\n❌  Slug réservé : « ${slug} » entre en collision avec une route du site. Choisis-en un autre.\n`);
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

  // data.json — UNIQUEMENT ce dont la page publique a besoin.
  // Tout le suivi (statut, dates, paiement, contacts) vit dans Airtable,
  // source de vérité unique. data.json est public : on n'y met rien d'autre.
  const today = new Date().toISOString().split('T')[0];
  const data = {
    slug,
    nom,
    rue: '',
    prix_reseaux: 39,
    prix_hd: 49,
    lien_stripe_reseaux: linkReseaux.url,
    lien_stripe_hd: linkHD.url,
  };
  fs.writeFileSync(path.join(clientDir, 'data.json'), JSON.stringify(data, null, 2));
  console.log('    ✅ data.json généré');

  // Airtable — fiche créée au statut « Créé » (l'envoi du DM/mail est manuel).
  // typecast: true → crée au besoin les options de listes déroulantes manquantes.
  if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
    try {
      const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
        .base(process.env.AIRTABLE_BASE_ID);
      await base(process.env.AIRTABLE_TABLE || 'Clients').create([{
        fields: {
          slug,
          Nom: nom,
          Statut: 'Créé',
          'Date création': today,
          Page: `${DOMAIN}/${slug}`,
          'Lien Stripe Réseaux': linkReseaux.url,
          'Lien Stripe HD': linkHD.url,
        },
      }], { typecast: true });
      console.log('    ✅ Fiche Airtable créée');
    } catch (e) {
      console.warn(`    ⚠️  Airtable ignoré (colonnes manquantes ?) : ${e.message}`);
    }
  }

  // Git push → Vercel redéploie (on ne pousse QUE le nouveau client, rien d'autre)
  console.log('\n📤  Push sur GitHub…');
  await git.add(`clients/${slug}`);
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

Bien à vous, Kévin Cardoso (@callme_keo), Photographe & AKOWIN Studios Founder

──────────────────────────────────────────────────────────
✉️  Email de 1er contact — Objet : J'ai photographié votre devanture
──────────────────────────────────────────────────────────

Bonjour,

En passant devant ${nom}, j'ai adoré votre devanture, je l'ai photographiée. Cette photo est pour vous, libre de droits.

J'ai réuni la photo et le reste de la série sur cette page dédiée (déverrouillable à l'achat) :
${pageUrl}

Bien à vous,
Kévin Cardoso (@callme_keo), Photographe & AKOWIN Studios Founder

──────────────────────────────────────────────────────────
`);
}

main().catch(err => {
  console.error(`\n❌  Erreur : ${err.message}\n`);
  process.exit(1);
});
