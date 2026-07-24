// Endpoint pontual para semear/ajustar um contador. Protegido pela chave do painel.
// Uso: /api/seed?key=PANEL&campo=cad:total&valor=18
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(path) {
  const r = await fetch(`${R_URL}/${path}`, { headers: { Authorization: `Bearer ${R_TOK}` } });
  return r.json();
}

const PERMITIDOS = ['cad:total', 'acc:total', 'dl:total', 'relato:total'];

export default async function handler(req, res) {
  try {
    const key = req.headers['x-panel-key'] || (req.query && req.query.key) || '';
    if (key !== process.env.PANEL_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!R_URL || !R_TOK) return res.status(200).json({ ok: false, error: 'storage-not-configured' });
    const campo = (req.query && req.query.campo) || '';
    const valor = parseInt((req.query && req.query.valor) || '', 10);
    if (!PERMITIDOS.includes(campo) || isNaN(valor)) return res.status(400).json({ ok: false, error: 'parametros-invalidos' });
    await redis(`set/${campo}/${valor}`);
    return res.status(200).json({ ok: true, campo, valor });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'internal' });
  }
}
