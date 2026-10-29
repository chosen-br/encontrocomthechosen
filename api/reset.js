// Zera contadores. Protegido pela chave do painel.
//   /api/reset?escopo=redirect  -> só os acessos do redirecionamento (rd:*)
//   /api/reset?escopo=arquivo   -> só as métricas do site antigo
//   /api/reset?escopo=tudo      -> ambos
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(path) {
  const r = await fetch(`${R_URL}/${path}`, { headers: { Authorization: `Bearer ${R_TOK}` } });
  return r.json();
}

const ARQUIVO = ['cad:total', 'cad:byday', 'acc:total', 'acc:byday', 'dl:total', 'dl:byres', 'dl:byday', 'relato:total', 'relato:ultimo', 'rel:byday', 't6:play', 't6:share', 't6:dl', 'popup:exibido', 'popup:alcance', 'popup:sim', 'popup:nao', 'popup:motivos'];

export default async function handler(req, res) {
  try {
    const key = req.headers['x-panel-key'] || (req.query && req.query.key) || '';
    if (key !== process.env.PANEL_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!R_URL || !R_TOK) return res.status(200).json({ ok: false, error: 'storage-not-configured' });

    const escopo = (req.query && req.query.escopo) || '';
    if (!['redirect', 'redirect-teste', 'arquivo', 'tudo', 'mover-para-teste'].includes(escopo)) {
      return res.status(400).json({ ok: false, error: 'informe escopo=redirect|redirect-teste|arquivo|tudo|mover-para-teste' });
    }

    // mover-para-teste: renomeia rd:* -> rdteste:* (usado uma vez, ao criar a fase de testes)
    if (escopo === 'mover-para-teste') {
      const r = await redis('keys/rd:*');
      const ks = r.result || [];
      for (const k of ks) await redis(`rename/${encodeURIComponent(k)}/${encodeURIComponent('rdteste:' + k.slice(3))}`);
      return res.status(200).json({ ok: true, movidas: ks.length });
    }

    let keys = [];
    if (escopo === 'arquivo' || escopo === 'tudo') keys = keys.concat(ARQUIVO);
    if (escopo === 'redirect' || escopo === 'tudo') keys = keys.concat((await redis('keys/rd:*')).result || []);
    if (escopo === 'redirect-teste' || escopo === 'tudo') keys = keys.concat((await redis('keys/rdteste:*')).result || []);
    for (const k of keys) await redis(`del/${encodeURIComponent(k)}`);

    return res.status(200).json({ ok: true, zerado: escopo, chaves: keys.length });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'internal' });
  }
}
