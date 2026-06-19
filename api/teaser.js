const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const SLUG_REGEX = /^[a-z0-9-]+$/;

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

  const { slug } = req.query;
  if (!slug || !SLUG_REGEX.test(slug)) return res.status(400).send('slug manquant ou invalide');

  const command = new GetObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET,
    Key: `${slug}/photos/teaser.jpeg`,
  });

  let url;
  try {
    url = await getSignedUrl(r2, command, { expiresIn: 3600 });
  } catch (err) {
    return res.status(500).send('Photo non disponible.');
  }

  return res.redirect(302, url);
};
