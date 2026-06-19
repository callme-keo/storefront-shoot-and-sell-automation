#!/usr/bin/env node
// Crée/complète les colonnes de la table Airtable "Clients" en une commande.
// Idempotent : relançable à volonté, il saute ce qui existe déjà.
// Nécessite un Personal Access Token (AIRTABLE_API_KEY) avec les scopes
// schema.bases:read ET schema.bases:write.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE || 'Clients';

if (!API_KEY || !BASE_ID) {
  console.error('\n❌  .env incomplet — AIRTABLE_API_KEY et AIRTABLE_BASE_ID requis.\n');
  process.exit(1);
}

const META = `https://api.airtable.com/v0/meta/bases/${BASE_ID}`;
const headers = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
const D_AUTO = '🤖 Rempli automatiquement par le code';
const D_MANUEL = '✋ À remplir manuellement';
const dateOpts = { dateFormat: { name: 'european', format: 'D/M/YYYY' } };

// Colonnes attendues. Celles qui existent déjà (slug, Date paiement, Pack acheté,
// Lien Stripe Réseaux, Lien Stripe HD) ne sont pas listées : on n'y touche pas.
const FIELDS = [
  { name: 'Nom', type: 'singleLineText', description: D_AUTO },
  { name: 'Statut', type: 'singleSelect', description: D_AUTO + ' / ✋ "Envoyé" manuel', options: { choices: [{ name: 'Créé' }, { name: 'Envoyé' }, { name: 'Relancé' }, { name: 'Payé' }] } },
  { name: 'Date création', type: 'date', description: D_AUTO, options: dateOpts },
  { name: 'Page', type: 'url', description: D_AUTO },
  { name: 'Montant', type: 'currency', description: D_AUTO, options: { precision: 2, symbol: '€' } },
  { name: 'J+21 programmé', type: 'checkbox', description: D_AUTO, options: { icon: 'check', color: 'greenBright' } },
  { name: 'Date J+21 prévue', type: 'date', description: D_AUTO, options: dateOpts },
  { name: 'Date relance', type: 'date', description: D_AUTO, options: dateOpts },
  { name: 'Instagram', type: 'singleLineText', description: D_MANUEL },
  { name: 'Email connu', type: 'email', description: D_MANUEL + ' (avant paiement)' },
  { name: 'Canal 1er contact', type: 'singleSelect', description: D_MANUEL, options: { choices: [{ name: 'DM Instagram' }, { name: 'Email' }] } },
  { name: 'Date 1er contact', type: 'date', description: D_MANUEL, options: dateOpts },
  { name: 'Adresse', type: 'singleLineText', description: D_MANUEL },
  { name: 'Notes', type: 'multilineText', description: D_MANUEL },
];

async function main() {
  // 1. Lire le schéma de la base → trouver la table + ses champs existants
  const res = await fetch(`${META}/tables`, { headers });
  if (!res.ok) {
    const t = await res.text();
    console.error(`\n❌  Lecture du schéma impossible (HTTP ${res.status}).`);
    if (res.status === 401 || res.status === 403) {
      console.error('   → Ton token doit être un Personal Access Token avec les scopes');
      console.error('     schema.bases:read ET schema.bases:write, et avoir accès à cette base.');
    }
    console.error(`   Réponse : ${t}\n`);
    process.exit(1);
  }

  const { tables } = await res.json();
  const table = tables.find(t => t.name === TABLE_NAME);
  if (!table) {
    console.error(`\n❌  Table « ${TABLE_NAME} » introuvable. Tables dispo : ${tables.map(t => t.name).join(', ')}\n`);
    process.exit(1);
  }

  const existing = new Set(table.fields.map(f => f.name));
  const byName = Object.fromEntries(table.fields.map(f => [f.name, f]));
  console.log(`\n📋  Table « ${TABLE_NAME} » — ${table.fields.length} champ(s) existant(s).\n`);

  // 2. Renommer « Email client » → « Email confirmé » si besoin
  if (byName['Email client'] && !existing.has('Email confirmé')) {
    const r = await fetch(`${META}/tables/${table.id}/fields/${byName['Email client'].id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ name: 'Email confirmé' }),
    });
    if (r.ok) { console.log('✏️   Renommé : « Email client » → « Email confirmé »'); existing.add('Email confirmé'); }
    else { console.warn(`⚠️   Renommage « Email client » échoué : ${await r.text()}`); }
  }

  // 3. Créer les colonnes manquantes
  let created = 0, skipped = 0, failed = 0;
  for (const field of FIELDS) {
    if (existing.has(field.name)) { console.log(`⏭️   Déjà présent : ${field.name}`); skipped++; continue; }
    const r = await fetch(`${META}/tables/${table.id}/fields`, {
      method: 'POST', headers, body: JSON.stringify(field),
    });
    if (r.ok) { console.log(`✅  Créé : ${field.name} (${field.type})`); created++; }
    else { console.warn(`⚠️   Échec « ${field.name} » : ${await r.text()}`); failed++; }
  }

  console.log(`\n🎉  Terminé — ${created} créée(s), ${skipped} déjà là${failed ? `, ${failed} en échec (à créer à la main)` : ''}.\n`);
}

main().catch(err => {
  console.error(`\n❌  Erreur : ${err.message}\n`);
  process.exit(1);
});
