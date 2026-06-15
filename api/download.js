const Stripe = require('stripe');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY,
  },
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  const { session_id, slug, pack } = req.query;

  if (!session_id || !slug || !pack) {
    return res.status(400).send('Paramètres manquants : session_id, slug, pack requis.');
  }

  // Vérification du paiement Stripe
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch {
    return res.status(400).send('Session de paiement introuvable.');
  }

  if (session.payment_status !== 'paid') {
    return res.status(403).send('Paiement non confirmé.');
  }

  if (session.metadata?.slug !== slug || session.metadata?.pack !== pack) {
    return res.status(403).send('Accès non autorisé.');
  }

  // URL signée R2 — expire dans 1 h
  const key = `${slug}/${pack}.zip`;
  const command = new GetObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET,
    Key: key,
  });

  let signedUrl;
  try {
    signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
  } catch (err) {
    console.error('[download] R2 error :', err.message);
    return res.status(500).send('Impossible de générer le lien de téléchargement.');
  }

  return res.redirect(302, signedUrl);
};
