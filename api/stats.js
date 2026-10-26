// Dados do painel privado. Exige a chave do painel.
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const TZ = 'America/Sao_Paulo';

async function redis(path) {
  const r = await fetch(`${R_URL}/${path}`, { headers: { Authorization: `Bearer ${R_TOK}` } });
  return r.json();
}

// Vários comandos numa requisição só (usado pelos dados do redirecionamento).
async function pipeline(cmds) {
  const r = await fetch(`${R_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${R_TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const arr = await r.json();
  return arr.map((x) => (x && x.result !== undefined ? x.result : null));
}

function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

function hashToList(result, keyName, valName) {
  const out = [];
  const arr = result || [];
  for (let i = 0; i < arr.length; i += 2) {
    out.push({ [keyName]: dec(arr[i]), [valName]: parseInt(arr[i + 1], 10) || 0 });
  }
  out.sort((a, b) => b[valName] - a[valName]);
  return out;
}

function hashToMap(result) {
  const map = {};
  const arr = result || [];
  for (let i = 0; i < arr.length; i += 2) map[arr[i]] = parseInt(arr[i + 1], 10) || 0;
  return map;
}

function diaBR(offset) {
  return new Date(Date.now() - offset * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
}

const DIMS = ['src', 'ref', 'path', 'utm_campaign', 'utm_medium', 'device', 'country', 'region', 'city'];

async function dadosRedirect() {
  const mes = diaBR(0).slice(0, 7);
  const cmds = [
    ['GET', 'rd:total'], ['GET', 'rd:humanos'], ['GET', 'rd:bots'], ['GET', 'rd:last'],
    ['HGETALL', 'rd:byday'], ['HGETALL', 'rd:byhour'], ['HGETALL', 'rd:byhour:' + mes],
  ];
  for (const d of DIMS) { cmds.push(['HGETALL', 'rd:' + d]); cmds.push(['HGETALL', 'rd:' + d + ':' + mes]); }
  const r = await pipeline(cmds);

  const byday = hashToMap(r[4]);
  const dias = [];
  for (let i = 29; i >= 0; i--) { const d = diaBR(i); dias.push({ dia: d, n: byday[d] || 0 }); }
  const soma = (a, b) => { let s = 0; for (let i = a; i <= b; i++) s += byday[diaBR(i)] || 0; return s; };
  const horas = (m) => { const out = []; for (let h = 0; h < 24; h++) { const k = String(h).padStart(2, '0'); out.push({ hora: k, n: m[k] || 0 }); } return out; };

  const tudo = {}, esteMes = {};
  DIMS.forEach((d, i) => {
    tudo[d] = hashToList(r[7 + i * 2], 'valor', 'n');
    esteMes[d] = hashToList(r[8 + i * 2], 'valor', 'n');
  });
  // total de acessos humanos por mês (derivado do byday)
  const porMes = {};
  Object.entries(byday).forEach(([d, n]) => { const m = d.slice(0, 7); porMes[m] = (porMes[m] || 0) + n; });

  return {
    total: parseInt(r[0], 10) || 0,
    humanos: parseInt(r[1], 10) || 0,
    bots: parseInt(r[2], 10) || 0,
    ultimo: r[3] || null,
    mes_atual: mes,
    hoje: soma(0, 0), ontem: soma(1, 1), ult7: soma(0, 6), ult30: soma(0, 29),
    dias,
    por_mes: Object.entries(porMes).sort().map(([m, n]) => ({ mes: m, n })),
    horas: { tudo: horas(hashToMap(r[5])), mes: horas(hashToMap(r[6])) },
    dims: { tudo, mes: esteMes },
  };
}

export default async function handler(req, res) {
  try {
    const key = req.headers['x-panel-key'] || (req.query && req.query.key) || '';
    if (key !== process.env.PANEL_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!R_URL || !R_TOK) return res.status(200).json({ ok: false, error: 'storage-not-configured' });

    const [total, relatos, ultimo, byres, pExib, pAlc, pSim, pNao, pMotivos, dlDias, relDias, acc, cad, tPlay, tShare, tDl, redirect] = await Promise.all([
      redis('get/dl:total'),
      redis('get/relato:total'),
      redis('get/relato:ultimo'),
      redis('hgetall/dl:byres'),
      redis('get/popup:exibido'),
      redis('get/popup:alcance'),
      redis('get/popup:sim'),
      redis('get/popup:nao'),
      redis('hgetall/popup:motivos'),
      redis('hgetall/dl:byday'),
      redis('hgetall/rel:byday'),
      redis('get/acc:total'),
      redis('get/cad:total'),
      redis('get/t6:play'),
      redis('get/t6:share'),
      redis('get/t6:dl'),
      dadosRedirect().catch(() => null),
    ]);

    // últimos 30 dias (fuso de Brasília), preenchendo zeros
    const dlMap = hashToMap(dlDias.result);
    const relMap = hashToMap(relDias.result);
    const dias = [];
    for (let i = 29; i >= 0; i--) {
      const d = diaBR(i);
      dias.push({ dia: d, downloads: dlMap[d] || 0, relatos: relMap[d] || 0 });
    }

    return res.status(200).json({
      ok: true,
      redirect,
      cadastros_total: parseInt(cad.result, 10) || 0,
      acessos_total: parseInt(acc.result, 10) || 0,
      downloads_total: parseInt(total.result, 10) || 0,
      relatos_total: parseInt(relatos.result, 10) || 0,
      ultimo_relato: ultimo.result ? dec(ultimo.result) : null,
      ranking: hashToList(byres.result, 'recurso', 'cliques'),
      dias,
      teaser: {
        play: parseInt(tPlay.result, 10) || 0,
        share: parseInt(tShare.result, 10) || 0,
        download: parseInt(tDl.result, 10) || 0,
      },
      popup: {
        exibido: parseInt(pExib.result, 10) || 0,
        alcance: parseInt(pAlc.result, 10) || 0,
        sim: parseInt(pSim.result, 10) || 0,
        nao: parseInt(pNao.result, 10) || 0,
        motivos: hashToList(pMotivos.result, 'motivo', 'respostas'),
      },
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'internal' });
  }
}
