#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const simpleGit = require('simple-git');
const Airtable = require('airtable');
const fs = require('fs');
const path = require('path');

const [,, slug] = process.argv;

if (!slug) {
  console.error('\n❌  Usage : node scripts/relance.js <slug>\n');
  process.exit(1);
}

if (!process.env.VERCEL_DOMAIN) {
  console.error('\n❌  .env incomplet — VERCEL_DOMAIN manquant.\n');
  process.exit(1);
}

const DOMAIN = process.env.VERCEL_DOMAIN.replace(/\/$/, '');
const ROOT = path.join(__dirname, '..');
const dataPath = path.join(ROOT, 'clients', slug, 'data.json');
const git = simpleGit(ROOT);

async function main() {
  if (!fs.existsSync(dataPath)) {
    console.error(`\n❌  Client introuvable : clients/${slug}/data.json n'existe pas.\n`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // On ne relance pas un client qui a déjà payé.
  if (data.statut === 'payé') {
    console.error(`\n❌  ${data.nom} a déjà payé (statut « payé ») — pas de relance.\n`);
    process.exit(1);
  }

  const today = new Date().toISOString().split('T')[0];
  const pageUrl = `${DOMAIN}/${slug}`;

  // Airtable — statut → relancé (non bloquant)
  if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
    try {
      const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
        .base(process.env.AIRTABLE_BASE_ID);
      const table = process.env.AIRTABLE_TABLE || 'Clients';
      const slugSafe = String(slug).replace(/"/g, '\\"');
      const records = await base(table)
        .select({ filterByFormula: `{slug} = "${slugSafe}"`, maxRecords: 1 })
        .firstPage();
      if (records.length) {
        await base(table).update(records[0].id, { Statut: 'relancé', 'Date relance': today });
        console.log('    ✅ Airtable : statut → relancé');
      } else {
        console.warn(`    ⚠️  Aucun enregistrement Airtable pour slug="${slug}"`);
      }
    } catch (e) {
      console.warn(`    ⚠️  Airtable ignoré : ${e.message}`);
    }
  }

  // data.json — statut local + date de relance, puis push (garde le repo à jour)
  data.statut = 'relancé';
  data.date_relance = today;
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

  await git.add(`clients/${slug}/data.json`);
  await git.commit(`relance: ${slug} — ${data.nom}`);
  await git.push('origin', 'main');
  console.log('    ✅ data.json mis à jour et poussé');

  // Textes prêts à coller
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  🔔  Relance : ${data.nom.padEnd(42)}  ║
╚══════════════════════════════════════════════════════════╝

📎  Page client :
    ${pageUrl}

──────────────────────────────────────────────────────────
💬  DM de relance à copier-coller :
──────────────────────────────────────────────────────────

Bonjour, je reviens vers vous au sujet de la photo de votre devanture. Votre page personnalisée reste disponible si vous souhaitez récupérer le reste de la série :
${pageUrl}

Je reste à votre disposition pour la moindre question.

Bien à vous, Kevin (Keo), AKOWIN Studios

──────────────────────────────────────────────────────────
✉️  Email de relance — Objet : Votre série photo est toujours disponible
──────────────────────────────────────────────────────────

Bonjour,

Je reviens vers vous au sujet de la photo de votre devanture. Votre page personnalisée reste disponible si vous souhaitez récupérer le reste de la série :
${pageUrl}

Je reste à votre disposition pour toute question.

Bien à vous,
Kevin (Keo), AKOWIN Studios

──────────────────────────────────────────────────────────
`);
}

main().catch(err => {
  console.error(`\n❌  Erreur : ${err.message}\n`);
  process.exit(1);
});
