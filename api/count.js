// Conta downloads (recebe o beacon da página). Fire-and-forget.
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(path) {
  const r = await fetch(`${R_URL}/${path}`, { headers: { Authorization: `Bearer ${R_TOK}` } });
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (!R_URL || !R_TOK) return res.status(200).json({ ok: false, error: 'storage-not-configured' });
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!body || body.k !== 'download') return res.status(200).json({ ok: false });
    const recurso = String(body.r || 'sem-nome').slice(0, 80);
    await redis('incr/dl:total');
    await redis(`hincrby/dl:byres/${encodeURIComponent(recurso)}/1`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}
