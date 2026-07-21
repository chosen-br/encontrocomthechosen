// Conta eventos da página (downloads e popup). Fire-and-forget.
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
    const k = body && body.k;
    const r = String((body && body.r) || '').slice(0, 90);

    if (k === 'download') {
      await redis('incr/dl:total');
      await redis(`hincrby/dl:byres/${encodeURIComponent(r || 'sem-nome')}/1`);
    } else if (k === 'popup_exibido') {
      await redis('incr/popup:exibido');
    } else if (k === 'popup_sim') {
      await redis('incr/popup:sim');
    } else if (k === 'popup_motivo') {
      await redis('incr/popup:nao');
      await redis(`hincrby/popup:motivos/${encodeURIComponent(r || 'sem-motivo')}/1`);
    } else {
      return res.status(200).json({ ok: false });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}
