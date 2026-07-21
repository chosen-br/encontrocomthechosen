// Zera todos os contadores. Protegido pela chave do painel.
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(path) {
  const r = await fetch(`${R_URL}/${path}`, { headers: { Authorization: `Bearer ${R_TOK}` } });
  return r.json();
}

export default async function handler(req, res) {
  try {
    const key = req.headers['x-panel-key'] || (req.query && req.query.key) || '';
    if (key !== process.env.PANEL_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!R_URL || !R_TOK) return res.status(200).json({ ok: false, error: 'storage-not-configured' });

    const keys = ['dl:total', 'dl:byres', 'relato:total', 'relato:ultimo', 'popup:exibido', 'popup:sim', 'popup:nao', 'popup:motivos'];
    for (const k of keys) await redis(`del/${k}`);

    return res.status(200).json({ ok: true, zerado: true });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'internal' });
  }
}
