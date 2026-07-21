// Dados do painel privado. Exige a chave do painel.
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(path) {
  const r = await fetch(`${R_URL}/${path}`, { headers: { Authorization: `Bearer ${R_TOK}` } });
  return r.json();
}

function hashToList(result, keyName, valName) {
  const out = [];
  const arr = result || [];
  for (let i = 0; i < arr.length; i += 2) {
    out.push({ [keyName]: decodeURIComponent(arr[i]), [valName]: parseInt(arr[i + 1], 10) || 0 });
  }
  out.sort((a, b) => b[valName] - a[valName]);
  return out;
}

export default async function handler(req, res) {
  try {
    const key = req.headers['x-panel-key'] || (req.query && req.query.key) || '';
    if (key !== process.env.PANEL_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!R_URL || !R_TOK) return res.status(200).json({ ok: false, error: 'storage-not-configured' });

    const [total, relatos, ultimo, byres, pExib, pSim, pNao, pMotivos] = await Promise.all([
      redis('get/dl:total'),
      redis('get/relato:total'),
      redis('get/relato:ultimo'),
      redis('hgetall/dl:byres'),
      redis('get/popup:exibido'),
      redis('get/popup:sim'),
      redis('get/popup:nao'),
      redis('hgetall/popup:motivos'),
    ]);

    return res.status(200).json({
      ok: true,
      downloads_total: parseInt(total.result, 10) || 0,
      relatos_total: parseInt(relatos.result, 10) || 0,
      ultimo_relato: ultimo.result ? decodeURIComponent(ultimo.result) : null,
      ranking: hashToList(byres.result, 'recurso', 'cliques'),
      popup: {
        exibido: parseInt(pExib.result, 10) || 0,
        sim: parseInt(pSim.result, 10) || 0,
        nao: parseInt(pNao.result, 10) || 0,
        motivos: hashToList(pMotivos.result, 'motivo', 'respostas'),
      },
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'internal' });
  }
}
