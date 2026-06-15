# 📷 Photo Storefront — Tunnel de vente pour photographes freelance

Tunnel complet pour vendre des packs photo à des commerces locaux via un lien unique :
photo-cadeau → page d'offre → paiement → livraison instantanée → facture PDF.

---

## Idée

Tu shootes la devanture d'un commerce dans l'après-midi.
Tu envoies **une photo offerte** en DM Instagram + un lien.
Le lien ouvre **leur page personnalisée** : la série verrouillée, deux formules tarifaires, un bouton shooting.
Ils paient → ils téléchargent immédiatement → ils peuvent générer leur facture en un clic.

> Coût total par prospect : ~25 min (15 min de shoot + 10 min de retouche teaser).
> Revenu par vente : 39–49 €. Objectif : convertir 1 boutique sur 4–5 contactées.

---

## Structure du projet

```
/
├── clients/
│   └── epicerie-du-marche/
│       ├── data.json          # fiche client (nom, slug, prix, statut)
│       └── photos/            # teaser.jpg + 01.jpg … 10.jpg + stories/ posts/
│
├── pages/
│   ├── [slug].html            # page d'offre dynamique (moule unique)
│   └── livraison/[slug].html  # page de livraison + facture
│
├── offre-devanture.html        # prototype statique (démo)
├── livraison-facture.html      # prototype statique (démo)
└── README.md
```

---

## Les deux pages (prototypes statiques inclus)

### 1. `offre-devanture.html` — Page d'offre
Ce que le commerçant voit en cliquant sur ton lien.

- Photo teaser offerte (hero)
- Planche-contact verrouillée (9 photos en aperçu flou)
- **Pack Réseaux — 39 €** : 10 stories + 10 posts recadrés, prêts à poster
- **Pack Réseaux + HD — 49 €** : idem + 10 photos pleine résolution
- Bouton **« Organisons un shooting »** → ouvre un email pré-rempli

### 2. `livraison-facture.html` — Page après paiement
Ce que le client voit après avoir réglé.

- Téléchargement instantané du `.zip`
- Bouton optionnel **« Établir une facture »**
- Formulaire vendeur/client → génère un **PDF conforme micro-entreprise** dans le navigateur (jsPDF, aucune donnée envoyée)
- Mentions légales incluses : TVA non applicable art. 293 B CGI, pénalités de retard, indemnité forfaitaire 40 €

---

## Stack cible (production)

| Besoin | Outil | Prix |
|---|---|---|
| Hébergement + routing dynamique `[slug]` | **Vercel** (Hobby) | Gratuit |
| Stockage photos + zip | **Cloudflare R2** | Gratuit jusqu'à ~10 Go |
| Base de données clients | **Supabase** (free tier) ou fichiers JSON | Gratuit |
| Paiement | **Stripe** Payment Links (1,5 % + 0,25 € sur cartes EEE) | Pay-as-you-go |
| Paiement alternatif moins cher | **Revolut Business** (~1 % + 0,20 €) | Pay-as-you-go |
| Facture conforme B2B (futur) | **Indy** ou **Pennylane** micro | ~0-10 €/mois |

> Revolut Business accepte les virements Stripe sur IBAN — tu peux combiner les deux.

---

## Ajouter un client

Trois gestes, jamais une nouvelle page :

**1. Créer le dossier client**
```
clients/
└── nom-du-commerce/
    ├── data.json
    └── photos/
        ├── teaser.jpg
        ├── 01.jpg … 10.jpg
        ├── stories/
        │   └── 01.jpg … 10.jpg
        └── posts/
            └── 01.jpg … 10.jpg
```

**2. Remplir `data.json`**
```json
{
  "slug": "nom-du-commerce",
  "nom": "Épicerie Fine du Marché",
  "rue": "8 place du Marché, 75011 Paris",
  "prix_reseaux": 39,
  "prix_hd": 49,
  "lien_stripe_reseaux": "https://buy.stripe.com/xxx",
  "lien_stripe_hd": "https://buy.stripe.com/yyy",
  "statut": "envoyé"   // envoyé | payé | upsell
}
```

**3. Envoyer le lien**
```
https://tonsite.com/nom-du-commerce
```

La page lit le slug dans l'URL, charge `data.json` et les photos du bon dossier.
La page de livraison débloque le bon `.zip` une fois le paiement confirmé (webhook Stripe).

---

## Workflow complet

```
Shoot devanture (15 min)
        │
        ▼
Retouche photo teaser (10 min, Lightroom preset)
        │
        ▼
Upload photos → dossier client (R2 / stockage)
        │
        ▼
Créer data.json + lien Stripe
        │
        ▼
DM Instagram :
  [photo teaser en image]
  "Bonjour, je suis passé cet après-midi devant votre boutique —
   je vous la laisse. Il y en a 9 autres + formats story et post
   déjà prêts si vous voulez la suite → [lien]"
        │
        ▼
Commerçant paie sur la page d'offre
        │
        ▼
Webhook Stripe → débloque le .zip sur la page de livraison
        │
        ▼
Client télécharge + génère sa facture PDF si besoin
        │
        ▼
Email de suivi J+3 :
  "Avez-vous pu poster les visuels ?
   Je serais ravi de shooter votre intérieur."
```

---

## Feuille de route

- [x] Prototype page d'offre (statique)
- [x] Prototype page livraison + facture PDF (statique)
- [ ] Routing dynamique `[slug]` sur Vercel (Next.js ou Astro)
- [ ] Intégration stockage Cloudflare R2
- [ ] Webhook Stripe pour déblocage automatique
- [ ] Dashboard léger (liste des boutiques + statut)
- [ ] Email de suivi automatique J+3 (Resend, gratuit jusqu'à 3 000/mois)
- [ ] Facture conforme e-invoicing B2B (entrée en vigueur sept. 2027)

---

## Légal (micro-entreprise France)

**Micro existante (autre activité) → pas besoin d'en ouvrir une nouvelle.**
Ajouter une activité secondaire *prestation de services / photographie commerciale* en 5 min sur autoentrepreneur.urssaf.fr. Même SIRET, même déclaration de CA.

- **Déclarer chaque encaissement** à l'échéance habituelle (mensuelle ou trimestrielle) — même à de petits montants. La facture circule chez le client pro, elle remonte forcément.
- **Facture obligatoire en B2B** quel que soit le montant (Code de commerce) — ce n'est pas optionnel comme en vente au détail B2C.
- Mention obligatoire : **« TVA non applicable, art. 293 B du CGI »**
- Numérotation séquentielle sans trou (ne pas générer côté navigateur seul — utiliser un compteur persistant, ex. Indy gratuit pour les micro)
- Licence d'utilisation limitée aux réseaux sociaux du commerce (à préciser dans les CGV)
- Pas de visages identifiables sans autorisation écrite
- E-invoicing B2B obligatoire à partir de **septembre 2027** pour les micro-entreprises

> ⚠️ Ne pas émettre de facture sans déclarer le CA correspondant : le commerçant passe la dépense en charge, son comptable l'enregistre avec ton SIRET — le croisement est automatique.

---

## Pricing recommandé

| Formule | Prix affiché | Stripe (−) | Urssaf 22 % (−) | **Net en poche** |
|---|---|---|---|---|
| Pack Réseaux | **39 €** | 0,84 € | 8,58 € | **≈ 30 €** |
| Pack Réseaux + HD | **49 €** | 0,99 € | 10,78 € | **≈ 37 €** |
| Shooting sur-mesure | **à partir de 300 €** | ~4,75 € | 66 € | **≈ 229 €** |

> Le pack n'est pas le centre de profit — c'est le coût d'acquisition du shooting.
> Partir sur 39/49 plutôt que 29/39 = +8 € net par vente, sans travail supplémentaire.

---

## Lancer en 30 minutes sans coder

1. Ouvre `offre-devanture.html`, remplace le nom de la boutique et les images
2. Crée un **Stripe Payment Link** (ou Revolut) pour chaque formule
3. Colle les liens dans les deux boutons
4. Dépose le fichier sur **Vercel** (drag & drop, aucune config)
5. Envoie le lien en DM avec la photo teaser

La version dynamique (slug) vient quand tu as une dizaine de boutiques à gérer.
