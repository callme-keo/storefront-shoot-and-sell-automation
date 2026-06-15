# CLAUDE.md — Photo Storefront · Kevin CARDOSO

## Ce projet

Tunnel de vente automatisé pour photographe freelance (micro-entreprise, France).
Kevin shoote des devantures de commerces locaux, envoie une photo offerte en DM Instagram
+ un lien vers une page personnalisée par boutique.

**Objectif session ce soir : tout automatiser.**
Kevin veut juste uploader ses photos au bon endroit — tout le reste doit tourner seul.

---

## Flux cible (entièrement automatisé)

```
Kevin uploade les photos sur R2 dans /[slug]/
        │
        ▼
node nouveau-client.js "slug" "Nom Boutique"
        │
        ├── Crée 2 Payment Links Stripe via API (39€ + 49€)
        ├── Génère clients/[slug]/data.json
        ├── Pushe sur GitHub → Vercel redéploie (30s)
        └── Affiche le lien + le texte DM prêt à coller
        │
        ▼
Kevin envoie le DM Instagram (1 seul message manuel, incontournable)
        │
        ▼
Commerçant paie sur la page d'offre
        │
        ▼
Webhook Stripe → api/webhook.js sur Vercel
        ├── Débloque le bon .zip sur R2 (token signé, pas d'URL en clair)
        ├── Met à jour Airtable : statut → "payé"
        └── Programme l'email de suivi J+3 via Resend
        │
        ▼
J+3 → Resend envoie l'email de suivi automatiquement
```

---

## Stack complète

| Besoin | Outil | Coût |
|---|---|---|
| Pages front | HTML/CSS/JS vanilla (déjà codées) | — |
| Hébergement + API serverless | Vercel (Hobby) | Gratuit |
| Stockage photos + zip | Cloudflare R2 | Gratuit ~10 Go |
| Paiement + webhooks | Stripe API | 1,5% + 0,25€/carte EEE |
| Dashboard suivi | Airtable (API) | Gratuit |
| Email suivi J+3 | Resend | Gratuit 3 000/mois |
| Script création client | Node.js local (Mac de Kevin) | Gratuit |

---

## Fichiers existants (déjà codés, ne pas retoucher le design)

```
/
├── CLAUDE.md
├── README.md
├── .gitignore
├── LICENSE
├── offre-devanture.html        ✅ page d'offre (Poppins + IBM Plex Mono + bleu #2243C8)
├── livraison-facture.html      ✅ page livraison + facture PDF (dynamique via ?pack=)
├── mentions-legales.html       ✅ mentions légales + CGV + RGPD
└── clients/
    └── [slug]/
        ├── data.json
        └── photos/
            ├── teaser.jpg
            ├── 01.jpg … 10.jpg
            ├── stories/01.jpg … 10.jpg
            └── posts/01.jpg … 10.jpg
```

---

## Fichiers à créer ce soir (dans cet ordre)

### 1. `scripts/nouveau-client.js`
Script Node.js lancé en local sur le Mac de Kevin.

**Arguments :** `slug` + `"Nom Boutique"`
**Actions :**
- Appelle l'API Stripe pour créer 2 Payment Links :
  - Pack Réseaux 39€ → `success_url: https://[domaine]/livraison-facture.html?pack=reseaux&slug=[slug]`
  - Pack HD 49€ → `success_url: https://[domaine]/livraison-facture.html?pack=hd&slug=[slug]`
- Génère `clients/[slug]/data.json` avec les liens Stripe auto
- Crée les dossiers `photos/`, `stories/`, `posts/`
- Git add + commit + push automatique
- Affiche dans le terminal :
  - L'URL de la page client
  - Le texte du DM prêt à coller

**Dépendances :** `stripe` `simple-git` `dotenv`

### 2. `api/webhook.js`
Fonction Vercel serverless — écoute les événements Stripe.

**Événement écouté :** `checkout.session.completed`
**Actions :**
- Vérifie la signature Stripe (STRIPE_WEBHOOK_SECRET)
- Récupère `slug` et `pack` depuis les metadata du Payment Link
- Génère un token signé (JWT ou UUID) pour débloquer le .zip sur R2
- Met à jour Airtable : statut → `payé`, date paiement, pack acheté
- Appelle Resend pour programmer l'email J+3

### 3. `api/download.js`
Fonction Vercel serverless — sert le .zip de manière sécurisée.

**Fonctionnement :**
- Reçoit `?token=xxx&slug=yyy&pack=zzz`
- Vérifie que le token est valide (généré par le webhook après paiement)
- Génère une URL signée Cloudflare R2 (expire dans 1h)
- Redirige vers l'URL signée → téléchargement immédiat
- Jamais d'URL R2 en clair exposée côté client

### 4. `.env` (ne jamais commiter — dans .gitignore)
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_R2_ACCESS_KEY=...
CLOUDFLARE_R2_SECRET_KEY=...
CLOUDFLARE_R2_BUCKET=photo-storefront
AIRTABLE_API_KEY=...
AIRTABLE_BASE_ID=...
RESEND_API_KEY=...
VERCEL_DOMAIN=https://ton-domaine.vercel.app
```

### 5. `emails/suivi-j3.html`
Template email de suivi envoyé automatiquement J+3.
Ton, sobre, dans la même identité visuelle.
```
Objet : Avez-vous pu utiliser vos photos ?

Bonjour,

J'espère que vos visuels vous ont plu.
Les avez-vous postés ? Je serais curieux de voir le résultat.

Si vous souhaitez aller plus loin — intérieur, produits, identité visuelle —
je suis disponible pour un shooting sur-mesure.

Kevin CARDOSO · @callme_keo
```

---

## Format data.json

```json
{
  "slug": "epicerie-du-marche",
  "nom": "Épicerie Fine du Marché",
  "rue": "8 place du Marché, 75011 Paris",
  "prix_reseaux": 39,
  "prix_hd": 49,
  "lien_stripe_reseaux": "https://buy.stripe.com/xxx",
  "lien_stripe_hd": "https://buy.stripe.com/yyy",
  "statut": "envoyé",
  "date_envoi": "2026-06-15",
  "date_paiement": null,
  "pack_achete": null
}
```

Statuts : `envoyé` | `payé` | `upsell` | `relancé`

---

## Design system (ne pas modifier)

- Fond page : `#EDEBE3` · Fond carte : `#FBFBF8` · Encre : `#17150F`
- Accent bleu roi : `#2243C8` · Muted : `#8C867A` · Ligne : `#E6E2D8`
- Fonts : `Poppins` (UI) + `IBM Plex Mono` (données, labels, mono)
- Hover boutons : noir `#0a0a0a`

---

## Infos Kevin

- **Nom :** Kevin CARDOSO
- **Email :** kevin.cardoso@icloud.com
- **Instagram :** @callme_keo
- **Statut :** Micro-entrepreneur (EI), activité photographie commerciale
- **SIRET :** [À REMPLIR]
- **TVA :** Non applicable, art. 293 B du CGI

---

## Pricing

| Formule | Prix | Net après Stripe + Urssaf 22% |
|---|---|---|
| Pack Réseaux | 39 € | ≈ 30 € |
| Pack Réseaux + HD | 49 € | ≈ 37 € |
| Shooting sur-mesure | dès 300 € | ≈ 229 € |

---

## Règles absolues

- Jamais de clé API en dur — toujours `.env`
- Jamais d'URL R2 en clair côté client — toujours des tokens signés
- Jamais une page par client — routing dynamique via slug
- Jamais commiter les photos — bloquées dans `.gitignore`
- Toujours vérifier la signature Stripe dans le webhook

---

## Ordre de build ce soir

1. `npm init` + installer les dépendances (`stripe` `simple-git` `dotenv` `jsonwebtoken` `resend` `airtable`)
2. Créer `.env` avec toutes les clés
3. Coder `scripts/nouveau-client.js`
4. Tester en mode Stripe test avec une vraie boutique fictive
5. Coder `api/webhook.js` + `api/download.js`
6. Configurer le webhook dans le dashboard Stripe (pointer vers Vercel)
7. Coder le template email `emails/suivi-j3.html`
8. Test end-to-end complet : script → lien live → paiement test → livraison → email J+3
9. Passer les clés Stripe en mode live
10. Premier vrai DM 🎯
