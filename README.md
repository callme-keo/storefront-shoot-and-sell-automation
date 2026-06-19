# 📷 Photo Storefront — Tunnel de vente pour photographe freelance

Tunnel de vente automatisé pour vendre des packs photo à des commerces locaux via un lien unique :
photo offerte en DM → page d'offre personnalisée → paiement Stripe → livraison instantanée du `.zip` → facture PDF → email de suivi J+21.

Kevin shoote, uploade ses photos, lance un script — tout le reste tourne seul.

---

## Idée

Tu shootes la devanture d'un commerce.
Tu envoies **une photo offerte** en DM Instagram + un lien vers **sa page personnalisée** : la série verrouillée, deux formules, un bouton shooting.
Il paie → il télécharge immédiatement → il peut générer sa facture en un clic → il reçoit un email de suivi 3 semaines plus tard.

> Coût par prospect : ~25 min (15 min de shoot + 10 min de retouche teaser).
> Revenu par vente : 39–49 €. Objectif : convertir 1 boutique sur 4–5 contactées.

---

## Comment ça marche (architecture réelle)

Pas de framework, pas de build : des **pages HTML statiques** + des **fonctions serverless Vercel**.
Le routing se fait par **paramètre d'URL `?slug=`** — une seule page sert tous les clients.

```
Kevin uploade les photos sur Cloudflare R2 dans  [slug]/
        │
        ▼
node scripts/nouveau-client.js "slug" "Nom Boutique"
        ├── crée 2 Payment Links Stripe (39 € / 49 €) via l'API
        ├── génère clients/[slug]/data.json
        ├── (option) crée la ligne Airtable
        └── git commit + push → Vercel redéploie (~30 s)
        │
        ▼
Kevin envoie le DM Instagram (seul geste manuel)
        │
        ▼
Le commerçant ouvre  /[slug]   (réécrit en offer.html?slug=[slug] par vercel.json)
   → la page lit data.json + affiche la photo teaser (/[slug]/free-photo)
   → branche les 2 boutons de paiement Stripe
        │
        ▼
Il paie → Stripe redirige vers
   /delivery?pack=[pack]&slug=[slug]&session_id=...
        │
        ├── bouton « Télécharger » → api/download
        │     vérifie le paiement Stripe, génère une URL R2 signée (1 h), redirige
        │
        └── webhook Stripe → api/webhook
              ├── met à jour Airtable (statut → payé)
              └── programme l'email de suivi J+21 (Resend)
```

---

## Structure du projet

```
/
├── offer.html                  # page d'offre (lit ?slug=)
├── delivery.html               # page post-paiement + facture PDF (jsPDF)
├── legal-notice.html           # mentions légales + CGV + RGPD
├── vercel.json                 # URLs propres : /[slug] → offer.html?slug=[slug]
│
├── api/
│   ├── teaser.js               # redirige vers la photo offerte (URL R2 signée)
│   ├── download.js             # sert le .zip après vérif du paiement (URL R2 signée)
│   └── webhook.js              # checkout.session.completed → Airtable + email J+21
│
├── scripts/
│   └── nouveau-client.js       # crée Payment Links + data.json + push
│
├── emails/
│   └── suivi-j21.html          # template de l'email de suivi
│
└── clients/
    └── [slug]/
        └── data.json           # fiche client (les photos sont sur R2, jamais dans git)
```

> Les dossiers `photos/`, `stories/`, `posts/` et tous les `*.zip` sont dans `.gitignore` — **jamais commités**. Les photos vivent uniquement sur R2.

---

## Arborescence sur Cloudflare R2 (important)

Le code attend exactement cette organisation par client. À respecter à l'upload, sinon le téléchargement renvoie une erreur :

```
[slug]/
├── reseaux.zip          ← servi par api/download pour le pack « reseaux »
├── hd.zip               ← servi par api/download pour le pack « hd »
└── photos/
    └── teaser.jpg       ← photo offerte, servie par api/teaser
```

- `api/download.js` lit la clé `[slug]/[pack].zip` (`reseaux.zip` ou `hd.zip`).
- `api/teaser.js` lit la clé `[slug]/photos/teaser.jpg`.

---

## Ajouter un client

```bash
node scripts/nouveau-client.js epicerie-du-marche "Épicerie Fine du Marché"
```

Le script :
1. crée les 2 Payment Links Stripe (avec `slug` + `pack` dans les metadata) ;
2. génère `clients/epicerie-du-marche/data.json` ;
3. crée la ligne Airtable si les clés sont présentes ;
4. commit + push → Vercel redéploie ;
5. affiche le lien de la page **et le texte du DM prêt à coller**.

Il ne reste qu'à uploader les photos sur R2 (voir arborescence ci-dessus) et envoyer le DM.

### Format `data.json`

```json
{
  "slug": "epicerie-du-marche",
  "nom": "Épicerie Fine du Marché",
  "rue": "",
  "prix_reseaux": 39,
  "prix_hd": 49,
  "lien_stripe_reseaux": "https://buy.stripe.com/xxx",
  "lien_stripe_hd": "https://buy.stripe.com/yyy"
}
```

`data.json` est **public** : il ne contient que ce dont la page d'offre a besoin. Tout le suivi (statut, dates, paiement, pack acheté, email) vit dans **Airtable**, seule source de vérité.
Le champ `rue` (vide par défaut) sert à pré-remplir l'adresse sur la facture du client.

---

## Variables d'environnement

Le fichier `.env` local n'est utilisé que par `scripts/nouveau-client.js`.
Les fonctions `api/*` tournent sur Vercel : **leurs variables doivent être définies dans Vercel** (Project Settings → Environment Variables, scope Production).

| Variable | Utilisée par | Rôle |
|---|---|---|
| `STRIPE_SECRET_KEY` | script + api | Clé secrète Stripe (live) |
| `STRIPE_WEBHOOK_SECRET` | webhook | Vérification de signature du webhook |
| `VERCEL_DOMAIN` | script | Domaine de prod (sans `/` final) pour les redirections |
| `CLOUDFLARE_ACCOUNT_ID` | download + teaser | Endpoint R2 |
| `CLOUDFLARE_R2_ACCESS_KEY` | download + teaser | Accès R2 |
| `CLOUDFLARE_R2_SECRET_KEY` | download + teaser | Accès R2 |
| `CLOUDFLARE_R2_BUCKET` | download + teaser | Nom du bucket |
| `AIRTABLE_API_KEY` | script + webhook | Dashboard suivi (optionnel) |
| `AIRTABLE_BASE_ID` | script + webhook | Base Airtable (optionnel) |
| `AIRTABLE_TABLE` | script + webhook | Nom de table (défaut : `Clients`) |
| `RESEND_API_KEY` | webhook | Envoi de l'email J+21 |
| `RESEND_FROM` | webhook | Expéditeur (domaine vérifié dans Resend) |
| `RESEND_REPLY_TO` | webhook | Adresse de réponse (défaut : `kevin@akowinstudios.com`) |
| `RESEND_WEBHOOK_SECRET` | resend-webhook | Vérification de signature du webhook Resend (suivi d'ouverture J+21) |

---

## Stack

| Besoin | Outil | Coût |
|---|---|---|
| Pages + fonctions serverless | **Vercel** (Hobby) | Gratuit |
| Stockage photos + zip | **Cloudflare R2** | Gratuit ~10 Go |
| Paiement + webhooks | **Stripe** (Payment Links) | 1,5 % + 0,25 €/carte EEE |
| Dashboard suivi | **Airtable** | Gratuit |
| Email de suivi J+21 | **Resend** | Gratuit 3 000/mois |

---

## Légal (micro-entreprise France)

- Activité secondaire *prestation de services / photographie commerciale* sur autoentrepreneur.urssaf.fr — même SIRET, même déclaration de CA.
- **Déclarer chaque encaissement** à l'échéance habituelle, même petit montant.
- **Facture obligatoire en B2B** quel que soit le montant.
- Mention obligatoire : **« TVA non applicable, art. 293 B du CGI »**.
- Numérotation séquentielle sans trou — la facture générée côté navigateur n'est pas un compteur persistant. Pour une compta carrée, basculer sur **Indy** ou **Pennylane** (micro, gratuit/peu cher).
- Licence d'utilisation limitée aux supports du commerce (détaillée dans les CGV).
- Pas de visages identifiables sans autorisation écrite.
- **E-invoicing B2B obligatoire à partir de septembre 2027** pour les micro-entreprises.

> ⚠️ Ne jamais émettre de facture sans déclarer le CA correspondant : le commerçant passe la dépense en charge avec ton SIRET, le croisement est automatique.

---

## Pricing

| Formule | Prix affiché | Net en poche (~Stripe + Urssaf 22 %) |
|---|---|---|
| Pack Réseaux | **39 €** | ≈ 30 € |
| Pack Réseaux + HD | **49 €** | ≈ 37 € |
| Shooting sur-mesure | **dès 300 €** | ≈ 229 € |

> Le pack n'est pas le centre de profit — c'est le coût d'acquisition du shooting.

---

## Feuille de route

- [x] Page d'offre dynamique (`?slug=`)
- [x] Page livraison + facture PDF (jsPDF, 100 % navigateur)
- [x] Mentions légales / CGV / RGPD
- [x] Stockage Cloudflare R2 (URL signées, jamais d'URL en clair)
- [x] Script de création client (Stripe Payment Links + data.json + push)
- [x] Webhook Stripe (Airtable + déclenchement email J+21)
- [x] Email de suivi automatique J+21 (Resend)
- [x] Expiration des liens de téléchargement (30 j)
- [x] Test end-to-end en conditions réelles (paiement → livraison → Airtable → email J+21)
- [x] Domaine de prod custom côté client (`creativeservices.akowinstudios.com`)
- [x] Script de relance (`scripts/relance.js`, statut `Relancé`, refuse si déjà payé)
- [x] Suivi d'ouverture du J+21 (webhook Resend → `J+21 envoyé` / `J+21 ouvert`)
- [ ] Facture conforme e-invoicing B2B (échéance sept. 2027)
