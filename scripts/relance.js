#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

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

async function main() {
  if (!fs.existsSync(dataPath)) {
    console.error(`\n❌  Client introuvable : clients/${slug}/data.json n'existe pas.\n`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const today = new Date().toISOString().split('T')[0];
  const pageUrl = `${DOMAIN}/${slug}`;

  // Airtable = source de vérité. On y lit le statut (pour ne PAS relancer un
  // client qui a déjà payé) puis on passe la fiche en « Relancé ».
  // typecast: true → crée au besoin l'option de liste déroulante manquante.
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
        const statut = String(records[0].get('Statut') || '').toLowerCase();
        if (statut === 'payé') {
          console.error(`\n❌  ${data.nom} a déjà payé — pas de relance.\n`);
          process.exit(1);
        }
        await base(table).update([{
          id: records[0].id,
          fields: { Statut: 'Relancé', 'Date relance': today },
        }], { typecast: true });
        console.log('    ✅ Airtable : statut → Relancé');
      } else {
        console.warn(`    ⚠️  Aucune fiche Airtable pour slug="${slug}" (relance quand même).`);
      }
    } catch (e) {
      console.warn(`    ⚠️  Airtable ignoré : ${e.message}`);
    }
  } else {
    console.warn('    ⚠️  Airtable non configuré — statut de paiement non vérifié.');
  }

  // Textes prêts à coller (envoi manuel par Kevin)
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

Bien à vous, Kévin Cardoso (@callme_keo), Photographe & AKOWIN Studios Founder

──────────────────────────────────────────────────────────
✉️  Email de relance — Objet : Votre série photo est toujours disponible
──────────────────────────────────────────────────────────

Bonjour,

Je reviens vers vous au sujet de la photo de votre devanture. Votre page personnalisée reste disponible si vous souhaitez récupérer le reste de la série :
${pageUrl}

Je reste à votre disposition pour toute question.

Bien à vous,
Kévin Cardoso (@callme_keo), Photographe & AKOWIN Studios Founder

──────────────────────────────────────────────────────────
`);
}

main().catch(err => {
  console.error(`\n❌  Erreur : ${err.message}\n`);
  process.exit(1);
});
