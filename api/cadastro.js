// Webhook do Zoho Forms (formulário de cadastro): cada cadastro soma +1.
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(path) {
  const r = await fetch(`${R_URL}/${path}`, { headers: { Authorization: `Bearer ${R_TOK}` } });
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (!R_URL || !R_TOK) return res.status(200).json({ ok: false, error: 'storage-not-configured' });
    const token = (req.query && req.query.token) || '';
    if (token !== process.env.WEBHOOK_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
    await redis('incr/cad:total');
    await redis(`hincrby/cad:byday/${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}/1`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}
