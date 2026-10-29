// Dados do painel privado. Exige a chave do painel.
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const TZ = 'America/Sao_Paulo';
const INICIO_OFICIAL = '2026-11-01'; // mesma data do proxy.js: antes, lê o espaço de teste; depois, o oficial

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
const MAX_DIAS = 400; // limite de um pedido personalizado (1 HGETALL por dia)

const diaValido = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
function somaDias(d, n) {
  const [Y, M, D] = d.split('-').map(Number);
  return new Date(Date.UTC(Y, M - 1, D) + n * 86400000).toISOString().slice(0, 10);
}
function difDias(a, b) { // b - a, em dias
  const u = (d) => { const [Y, M, D] = d.split('-').map(Number); return Date.UTC(Y, M - 1, D); };
  return Math.round((u(b) - u(a)) / 86400000);
}

// Resolve o período pedido pelo painel. Presets: 7, 30, mes, tudo. Personalizado: de + ate (YYYY-MM-DD).
function resolvePeriodo(q, hoje) {
  q = q || {};
  if (diaValido(q.de) && diaValido(q.ate)) {
    let de = q.de, ate = q.ate;
    if (ate > hoje) ate = hoje;
    if (de > ate) [de, ate] = [ate, de];
    if (difDias(de, ate) >= MAX_DIAS) de = somaDias(ate, -(MAX_DIAS - 1));
    return { preset: 'custom', de, ate };
  }
  const p = String(q.p || 'mes');
  if (p === '7') return { preset: '7', de: somaDias(hoje, -6), ate: hoje };
  if (p === '30') return { preset: '30', de: somaDias(hoje, -29), ate: hoje };
  if (p === 'tudo') return { preset: 'tudo', de: null, ate: hoje };
  return { preset: 'mes', de: hoje.slice(0, 8) + '01', ate: hoje };
}

async function dadosRedirect(query) {
  const hoje = diaBR(0);
  const ns = hoje < INICIO_OFICIAL ? 'rdteste:' : 'rd:';
  const per = resolvePeriodo(query, hoje);

  // 1ª rodada: totais, série diária e os acumulados "desde o início"
  const cmds = [
    ['GET', ns + 'total'], ['GET', ns + 'humanos'], ['GET', ns + 'bots'], ['GET', ns + 'last'],
    ['HGETALL', ns + 'byday'], ['HGETALL', ns + 'byhour'], ['HGETALL', ns + 'bots:motivo'], ['HGETALL', ns + 'bots:path'],
  ];
  for (const d of DIMS) cmds.push(['HGETALL', ns + d]);
  const r = await pipeline(cmds);
  const byday = hashToMap(r[4]);
  const diasComDados = Object.keys(byday).sort();
  const primeiro = diasComDados[0] || hoje;
  if (per.preset === 'tudo') per.de = primeiro < hoje ? primeiro : somaDias(hoje, -29);
  const soma = (a, b) => { let s = 0; for (let i = a; i <= b; i++) s += byday[diaBR(i)] || 0; return s; };

  // série do período
  const dias = [];
  for (let d = per.de; d <= per.ate; d = somaDias(d, 1)) dias.push({ dia: d, n: byday[d] || 0 });
  const nPeriodo = dias.reduce((s, x) => s + x.n, 0);

  // O período cobre tudo que existe? Então usa os acumulados (exatos desde o início). Senão, soma os hashes diários.
  const cobreTudo = per.de <= primeiro && per.ate === hoje;
  const horasDe = (m) => { const out = []; for (let h = 0; h < 24; h++) { const k = String(h).padStart(2, '0'); out.push({ hora: k, n: m[k] || 0 }); } return out; };
  let dims = {}, horas, botsMotivos, botsPaths, nBots;
  if (cobreTudo) {
    DIMS.forEach((d, i) => { dims[d] = hashToList(r[8 + i], 'valor', 'n'); });
    horas = horasDe(hashToMap(r[5]));
    botsMotivos = hashToList(r[6], 'valor', 'n');
    botsPaths = hashToList(r[7], 'valor', 'n');
    nBots = parseInt(r[2], 10) || 0;
  } else {
    const agg = {}; DIMS.forEach((d) => { agg[d] = {}; });
    const hm = {}, bm = {}, bp = {};
    const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
    const rr = await pipeline(dias.map((x) => ['HGETALL', ns + 'd:' + x.dia]));
    for (const arr of rr) {
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 2) {
        const f = arr[i], v = parseInt(arr[i + 1], 10) || 0;
        const eq = f.indexOf('='); if (eq < 0) continue;
        const k = f.slice(0, eq), val = f.slice(eq + 1);
        if (k === 'hour') add(hm, val, v);
        else if (k === 'bot') add(bm, val, v);
        else if (k === 'botpath') add(bp, val, v);
        else if (agg[k]) add(agg[k], val, v);
      }
    }
    const lista = (o) => Object.entries(o).map(([valor, n]) => ({ valor: dec(valor), n })).sort((a, b) => b.n - a.n);
    DIMS.forEach((d) => { dims[d] = lista(agg[d]); });
    horas = horasDe(hm);
    botsMotivos = lista(bm);
    botsPaths = lista(bp);
    nBots = botsMotivos.reduce((s, x) => s + x.n, 0);
  }

  return {
    total: parseInt(r[0], 10) || 0,
    humanos: parseInt(r[1], 10) || 0,
    bots: parseInt(r[2], 10) || 0,
    ultimo: r[3] || null,
    fase: ns === 'rd:' ? 'oficial' : 'teste',
    inicio_oficial: INICIO_OFICIAL,
    hoje_dia: hoje,
    primeiro_dia: diasComDados[0] || null,
    hoje: soma(0, 0), ontem: soma(1, 1), ult7: soma(0, 6), ult30: soma(0, 29),
    periodo: {
      preset: per.preset, de: per.de, ate: per.ate, completo: cobreTudo,
      n: nPeriodo, dias, horas, dims,
      bots: { n: nBots, motivos: botsMotivos, paths: botsPaths },
    },
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
      dadosRedirect(req.query).catch(() => null),
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
