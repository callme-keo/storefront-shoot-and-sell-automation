#!/usr/bin/env node
// Crée/complète les colonnes de la table Airtable "Clients" en une commande.
// Idempotent : relançable à volonté (saute l'existant, renomme si besoin).
// Les colonnes que TU remplis sont préfixées "✋ " ; les autres sont automatiques.
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

// Colonnes 🤖 automatiques (le code écrit dedans — noms EXACTS obligatoires).
const AUTO_FIELDS = [
  { name: 'Nom', type: 'singleLineText', description: D_AUTO },
  { name: 'Statut', type: 'singleSelect', description: D_AUTO + ' / ✋ "Envoyé" manuel', options: { choices: [{ name: 'Créé' }, { name: 'Envoyé' }, { name: 'Relancé' }, { name: 'Payé' }] } },
  { name: 'Date création', type: 'date', description: D_AUTO, options: dateOpts },
  { name: 'Page', type: 'url', description: D_AUTO },
  { name: 'Montant', type: 'currency', description: D_AUTO, options: { precision: 2, symbol: '€' } },
  { name: 'J+21 programmé', type: 'checkbox', description: D_AUTO, options: { icon: 'check', color: 'greenBright' } },
  { name: 'Date J+21 prévue', type: 'date', description: D_AUTO, options: dateOpts },
  { name: 'J+21 envoyé', type: 'checkbox', description: D_AUTO + ' (webhook Resend)', options: { icon: 'check', color: 'greenBright' } },
  { name: 'J+21 ouvert', type: 'checkbox', description: D_AUTO + ' (webhook Resend)', options: { icon: 'check', color: 'blueBright' } },
  { name: 'Date relance', type: 'date', description: D_AUTO, options: dateOpts },
];

// Colonnes ✋ manuelles (préfixées). `legacy` = ancien nom à renommer le cas échéant.
const MANUAL_FIELDS = [
  { name: '✋ Instagram', legacy: 'Instagram', type: 'singleLineText', description: D_MANUEL },
  { name: '✋ Email connu', legacy: 'Email connu', type: 'email', description: D_MANUEL + ' (avant paiement)' },
  { name: '✋ Canal 1er contact', legacy: 'Canal 1er contact', type: 'singleSelect', description: D_MANUEL, options: { choices: [{ name: 'DM Instagram' }, { name: 'Email' }] } },
  { name: '✋ Date 1er contact', legacy: 'Date 1er contact', type: 'date', description: D_MANUEL, options: dateOpts },
  { name: '✋ Adresse', legacy: 'Adresse', type: 'singleLineText', description: D_MANUEL },
  { name: '✋ Notes', legacy: 'Notes', type: 'multilineText', description: D_MANUEL },
];

async function renameField(table, fieldId, newName) {
  const r = await fetch(`${META}/tables/${table.id}/fields/${fieldId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ name: newName }),
  });
  return r.ok ? null : await r.text();
}

async function createField(table, field) {
  const { legacy, ...body } = field;
  const r = await fetch(`${META}/tables/${table.id}/fields`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return r.ok ? null : await r.text();
}

async function main() {
  const res = await fetch(`${META}/tables`, { headers });
  if (!res.ok) {
    const t = await res.text();
    console.error(`\n❌  Lecture du schéma impossible (HTTP ${res.status}).`);
    if (res.status === 401 || res.status === 403) {
      console.error('   → Token requis : Personal Access Token avec scopes');
      console.error('     schema.bases:read ET schema.bases:write, accès à cette base.');
    }
    console.error(`   Réponse : ${t}\n`);
    process.exit(1);
  }

  const { tables } = await res.json();
  const table = tables.find((t) => t.name === TABLE_NAME);
  if (!table) {
    console.error(`\n❌  Table « ${TABLE_NAME} » introuvable. Tables : ${tables.map((t) => t.name).join(', ')}\n`);
    process.exit(1);
  }

  const existing = new Set(table.fields.map((f) => f.name));
  const byName = Object.fromEntries(table.fields.map((f) => [f.name, f]));
  console.log(`\n📋  Table « ${TABLE_NAME} » — ${table.fields.length} champ(s) existant(s).\n`);

  // Renommages : Email client → Email confirmé, puis ancien → préfixé ✋
  const renames = [{ from: 'Email client', to: 'Email confirmé' }];
  for (const f of MANUAL_FIELDS) renames.push({ from: f.legacy, to: f.name });
  for (const { from, to } of renames) {
    if (byName[from] && !existing.has(to)) {
      const err = await renameField(table, byName[from].id, to);
      if (!err) { console.log(`✏️   Renommé : « ${from} » → « ${to} »`); existing.add(to); existing.delete(from); }
      else { console.warn(`⚠️   Renommage « ${from} » échoué : ${err}`); }
    }
  }

  // Création des colonnes manquantes
  let created = 0, skipped = 0, failed = 0;
  for (const field of [...AUTO_FIELDS, ...MANUAL_FIELDS]) {
    if (existing.has(field.name)) { console.log(`⏭️   Déjà présent : ${field.name}`); skipped++; continue; }
    const err = await createField(table, field);
    if (!err) { console.log(`✅  Créé : ${field.name} (${field.type})`); created++; }
    else { console.warn(`⚠️   Échec « ${field.name} » : ${err}`); failed++; }
  }

  console.log(`\n🎉  Terminé — ${created} créée(s), ${skipped} déjà là${failed ? `, ${failed} en échec` : ''}.`);
  console.log('   ✋ = à remplir par toi · les autres se remplissent toutes seules.\n');
}

main().catch((err) => {
  console.error(`\n❌  Erreur : ${err.message}\n`);
  process.exit(1);
});
