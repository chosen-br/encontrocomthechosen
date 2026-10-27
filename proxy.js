// Routing Middleware (Vercel, runtime Node). O domínio virou um redirecionamento: toda visita é
// registrada (sem cookie, sem script, sem IP) e enviada para o destino.
// Exceções: /painel (dashboard privado) e /api/* (stats/reset do painel).
const DESTINO = 'https://resources.comeandseefoundation.org/';
const TZ = 'America/Sao_Paulo';

// O matcher (quais rotas passam por aqui) fica no vercel.json, em proxy.matcher.

const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp\/|telegrambot|skypeuripreview|preview|headless|curl\/|wget|python-requests|go-http-client|vercel-screenshot|lighthouse|pingdom|uptime/i;

function origem(refHost, utmSource) {
  if (utmSource) return utmSource.toLowerCase().slice(0, 40);
  const h = (refHost || '').toLowerCase();
  if (!h) return 'direto';
  if (h.includes('instagram')) return 'instagram';
  if (h.includes('facebook') || h.startsWith('fb.') || h === 'm.me') return 'facebook';
  if (h.includes('whatsapp') || h === 'wa.me') return 'whatsapp';
  if (h.includes('youtube') || h === 'youtu.be') return 'youtube';
  if (h.includes('google')) return 'google';
  if (h.includes('bing.')) return 'bing';
  if (h === 't.co' || h.includes('twitter') || h === 'x.com') return 'x';
  if (h.includes('linkedin')) return 'linkedin';
  if (h.includes('tiktok')) return 'tiktok';
  if (h === 't.me' || h.includes('telegram')) return 'telegram';
  if (h.includes('thechosen')) return 'thechosen';
  return 'outros';
}

function dispositivo(ua) {
  if (/ipad|tablet|kindle|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|windows phone/i.test(ua)) return 'celular';
  return 'desktop';
}

function geo(req) {
  const h = (n) => req.headers.get(n) || '';
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  return {
    country: h('x-vercel-ip-country').toUpperCase() || 'desconhecido',
    region: h('x-vercel-ip-country-region').toUpperCase() || 'desconhecido',
    city: dec(h('x-vercel-ip-city')) || 'desconhecida',
  };
}

function agora() {
  const d = new Date();
  const dia = d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const hora = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).slice(0, 2);
  return { dia, mes: dia.slice(0, 7), hora, iso: d.toISOString() };
}

export default function middleware(req, ctx) {
  const url = new URL(req.url);
  const destino = new URL(DESTINO);
  url.searchParams.forEach((v, k) => destino.searchParams.append(k, v)); // preserva UTMs
  // Response.redirect tem headers imutáveis; montamos à mão
  const resposta = new Response(null, {
    status: 307,
    headers: { Location: destino.toString(), 'x-tc-mw': '1' }, // x-tc-mw: diagnóstico (prova que o middleware respondeu)
  });

  try {
    if (!R_URL || !R_TOK) return resposta;
    const path = url.pathname;
    if (/\.[a-z0-9]{2,5}$/i.test(path)) return resposta; // favicon, imagens etc. não contam

    const ua = req.headers.get('user-agent') || '';
    const t = agora();
    const cmds = [['INCR', 'rd:total'], ['SET', 'rd:last', t.iso]];

    if (BOT_RE.test(ua) || !ua) {
      cmds.push(['INCR', 'rd:bots']);
    } else {
      let refHost = '';
      try { refHost = new URL(req.headers.get('referer') || '').hostname; } catch (e) {}
      const q = url.searchParams;
      const g = geo(req);
      const dims = {
        src: origem(refHost, q.get('utm_source')),
        ref: refHost || 'direto',
        path: path === '/' ? '/' : path.toLowerCase().slice(0, 60),
        utm_campaign: (q.get('utm_campaign') || '').toLowerCase().slice(0, 60),
        utm_medium: (q.get('utm_medium') || '').toLowerCase().slice(0, 40),
        device: dispositivo(ua),
        country: g.country,
        region: g.country === 'BR' ? g.region : g.country + '-' + g.region,
        city: g.city,
      };
      cmds.push(['INCR', 'rd:humanos']);
      cmds.push(['HINCRBY', 'rd:byday', t.dia, 1]);
      cmds.push(['HINCRBY', 'rd:byhour', t.hora, 1]);
      cmds.push(['HINCRBY', 'rd:byhour:' + t.mes, t.hora, 1]);
      for (const [k, v] of Object.entries(dims)) {
        if (!v) continue;
        cmds.push(['HINCRBY', 'rd:' + k, v, 1]);
        cmds.push(['HINCRBY', 'rd:' + k + ':' + t.mes, v, 1]);
      }
    }

    const grava = fetch(R_URL + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + R_TOK, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    }).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(grava);
  } catch (e) { /* nunca bloqueia o redirect */ }

  return resposta;
}
