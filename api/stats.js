// Dados do painel privado. Exige a chave do painel.
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

    const [total, relatos, ultimo, byres] = await Promise.all([
      redis('get/dl:total'),
      redis('get/relato:total'),
      redis('get/relato:ultimo'),
      redis('hgetall/dl:byres'),
    ]);

    // hgetall retorna array alternado [campo, valor, campo, valor...]
    const ranking = [];
    const arr = byres.result || [];
    for (let i = 0; i < arr.length; i += 2) {
      ranking.push({ recurso: decodeURIComponent(arr[i]), cliques: parseInt(arr[i + 1], 10) || 0 });
    }
    ranking.sort((a, b) => b.cliques - a.cliques);

    return res.status(200).json({
      ok: true,
      downloads_total: parseInt(total.result, 10) || 0,
      relatos_total: parseInt(relatos.result, 10) || 0,
      ultimo_relato: ultimo.result ? decodeURIComponent(ultimo.result) : null,
      ranking,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'internal' });
  }
}
