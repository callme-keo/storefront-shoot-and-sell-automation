#!/usr/bin/env node
// Upload des fichiers d'un client sur Cloudflare R2 via l'API S3.
// Contourne la limite de 300 Mo/fichier du dashboard web (hd.zip est gros).
// Réutilise les identifiants R2 du .env (mêmes que api/teaser.js & api/download.js).
//
// Usage :
//   node scripts/upload-r2.js <slug> [dossier-source]
//   ex. node scripts/upload-r2.js chymos "/Users/keo/Desktop/chymos"
//
// Le dossier source doit contenir : reseaux.zip, hd.zip, photos/teaser.jpeg,
// _source/stories/01.jpg…NN.jpg (par défaut, on cherche dans clients/<slug>/).
// Les vignettes basse résolution de la planche contact (offer.html) sont
// générées automatiquement depuis _source/stories/ à chaque upload.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const [, , slug, srcArg] = process.argv;

const SLUG_REGEX = /^[a-z0-9-]+$/;
if (!slug || !SLUG_REGEX.test(slug)) {
  console.error('\n❌  Usage : node scripts/upload-r2.js <slug> [dossier-source]');
  console.error('   Slug en minuscules/chiffres/tirets uniquement (ex. chymos).\n');
  process.exit(1);
}

const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_KEY', 'CLOUDFLARE_R2_BUCKET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\n❌  .env incomplet — manquant : ${missing.join(', ')}\n`);
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const srcDir = srcArg ? path.resolve(srcArg) : path.join(ROOT, 'clients', slug);
const BUCKET = process.env.CLOUDFLARE_R2_BUCKET;

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY,
  },
});

// Les 3 fichiers attendus par client (clés R2 = exactement ce que lit le code).
const FILES = [
  { local: 'reseaux.zip', key: `${slug}/reseaux.zip`, type: 'application/zip' },
  { local: 'hd.zip', key: `${slug}/hd.zip`, type: 'application/zip' },
  { local: path.join('photos', 'teaser.jpeg'), key: `${slug}/photos/teaser.jpeg`, type: 'image/jpeg' },
];

const mo = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

// Vignettes de la planche contact : volontairement minuscules (48px de large,
// qualité 40) — même en désactivant le flou CSS côté client, aucun détail
// exploitable n'est visible. Générées depuis les photos sources, jamais
// depuis les fichiers pleine résolution.
const STORIES_SRC = path.join(srcDir, '_source', 'stories');
const PREVIEW_WIDTH = 48;
const PREVIEW_QUALITY = 40;

async function uploadPreviews() {
  if (!fs.existsSync(STORIES_SRC)) {
    console.warn(`    ⚠️  Pas de vignettes planche contact : dossier introuvable → ${STORIES_SRC}`);
    return { ok: 0, total: 0 };
  }
  const files = fs.readdirSync(STORIES_SRC).filter((f) => /^\d{2}\.jpe?g$/i.test(f)).sort();
  let ok = 0;
  for (const file of files) {
    const n = path.parse(file).name;
    const key = `${slug}/photos/preview/${n}.jpg`;
    process.stdout.write(`    🖼️  vignette ${file} → ${key} … `);
    try {
      const buffer = await sharp(path.join(STORIES_SRC, file))
        .resize({ width: PREVIEW_WIDTH })
        .jpeg({ quality: PREVIEW_QUALITY })
        .toBuffer();
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
      }));
      console.log('✅');
      ok++;
    } catch (e) {
      console.log('❌');
      console.error(`       Erreur : ${e.message}`);
    }
  }
  return { ok, total: files.length };
}

async function uploadOne(file) {
  const full = path.join(srcDir, file.local);
  if (!fs.existsSync(full)) {
    console.warn(`    ⚠️  Introuvable, ignoré : ${file.local}`);
    return false;
  }
  const size = fs.statSync(full).size;
  process.stdout.write(`    ⬆️  ${file.local} (${mo(size)}) → ${file.key} … `);
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: file.key,
    Body: fs.createReadStream(full),
    ContentLength: size,
    ContentType: file.type,
  }));
  console.log('✅');
  return true;
}

async function main() {
  if (!fs.existsSync(srcDir)) {
    console.error(`\n❌  Dossier source introuvable : ${srcDir}\n`);
    process.exit(1);
  }
  console.log(`\n📦  Upload R2 — client « ${slug} » (bucket : ${BUCKET})`);
  console.log(`    Source : ${srcDir}\n`);

  let ok = 0;
  for (const file of FILES) {
    try {
      if (await uploadOne(file)) ok++;
    } catch (e) {
      console.log('❌');
      console.error(`       Erreur : ${e.message}`);
    }
  }

  console.log(`\n${ok === FILES.length ? '🎉' : '⚠️'}  ${ok}/${FILES.length} fichier(s) uploadé(s).`);
  if (ok !== FILES.length) {
    console.log('    Vérifie les noms : reseaux.zip, hd.zip, photos/teaser.jpeg');
  }

  console.log('\n🖼️  Vignettes planche contact :');
  const previews = await uploadPreviews();
  if (previews.total > 0) {
    console.log(`   ${previews.ok}/${previews.total} vignette(s) uploadée(s).`);
  }

  if (ok === FILES.length) {
    const domain = (process.env.VERCEL_DOMAIN || '').replace(/\/$/, '');
    console.log(`\n    Vérif photo offerte : ${domain}/${slug}/free-photo\n`);
  } else {
    console.log('');
  }
}

main().catch((err) => {
  console.error(`\n❌  Erreur : ${err.message}\n`);
  process.exit(1);
});
