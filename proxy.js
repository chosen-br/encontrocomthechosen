// Routing Middleware (Vercel, runtime Node). O domínio virou um redirecionamento: toda visita é
// registrada (sem cookie, sem script, sem IP) e enviada para o destino.
// Exceções: /painel (dashboard privado), /api/* (stats/reset do painel) e /og.jpg (imagem do cartão de prévia).
const DESTINO = 'https://resources.comeandseefoundation.org/';
const TZ = 'America/Sao_Paulo';
// Contagem oficial começa em 01/11/2026 00:00 (Brasília). Antes disso, os acessos vão para o espaço de teste
// (chaves rdteste:*) e não misturam com os oficiais (rd:*). A virada é automática, pela data em Brasília.
const INICIO_OFICIAL = '2026-11-01';

// O matcher (quais rotas passam por aqui) fica no vercel.json, em proxy.matcher.

const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp\/|telegrambot|skypeuripreview|preview|headless|curl\/|wget|python-requests|go-http-client|vercel-screenshot|lighthouse|pingdom|uptime/i;
// Varreduras automáticas que se disfarçam de navegador: procuram WordPress, arquivos de config etc.
// (/.well-known/traffic-advice é o Chrome/Google checando se pode pré-carregar — também não é pessoa.)
const SCANNER_PATH_RE = /^\/(\.well-known|wp-admin|wp-login|wp-content|wp-includes|wp-json|xmlrpc|\.env|\.git|\.aws|phpmyadmin|cgi-bin|vendor\/|administrator|owa\/|autodiscover|backup|config\.|setup\.|install\.)|\.(php|asp|aspx|jsp|cgi)$/i;
// Scanners de segurança de e-mail corporativo: abrem o link antes da pessoa clicar.
const EMAIL_SCANNER_RE = /defend\.egress|safelinks\.protection\.outlook|urldefense|proofpoint|mimecast|barracuda|clicktime\.symantec|linkprotect\.cudasvc|protection\.sophos/i;
function motivoRobo(ua, path, refHost) {
  if (!ua) return 'sem-user-agent';
  if (BOT_RE.test(ua)) return 'robo-declarado';
  if (SCANNER_PATH_RE.test(path)) return 'varredura';
  if (EMAIL_SCANNER_RE.test(refHost)) return 'scanner-de-email';
  return '';
}

// Robôs que montam o cartão de prévia de link (WhatsApp, Messenger/iMessage, Telegram, X, LinkedIn, Slack, Discord)
// recebem uma página mínima só com as tags Open Graph abaixo, em vez do redirect. Pessoas nunca veem essa página;
// o Googlebot não está aqui de propósito (segue o redirect, melhor para SEO).
const PREVIEW_RE = /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|skypeuripreview|pinterest|embedly|vkshare/i;
const OG = {
  title: 'Recursos gratuitos de The Chosen para sua igreja',
  desc: 'Cenas, perguntas para discussão, guias de episódio e notas de ensino para liderar, compartilhar e discipular.',
  image: 'https://encontrocomthechosen.com.br/og.jpg', // 1200x630, servido direto (fora do redirect: ver matcher no vercel.json)
  url: 'https://encontrocomthechosen.com.br/',
};
function paginaPrevia() {
  const e = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">'
    + '<title>' + e(OG.title) + '</title>'
    + '<meta name="description" content="' + e(OG.desc) + '">'
    + '<meta property="og:type" content="website"><meta property="og:locale" content="pt_BR">'
    + '<meta property="og:site_name" content="Encontro com The Chosen">'
    + '<meta property="og:title" content="' + e(OG.title) + '">'
    + '<meta property="og:description" content="' + e(OG.desc) + '">'
    + '<meta property="og:url" content="' + OG.url + '">'
    + '<meta property="og:image" content="' + OG.image + '"><meta property="og:image:secure_url" content="' + OG.image + '">'
    + '<meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    + '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + e(OG.title) + '">'
    + '<meta name="twitter:description" content="' + e(OG.desc) + '"><meta name="twitter:image" content="' + OG.image + '">'
    + '</head><body><p><a href="' + DESTINO + '">' + e(OG.title) + '</a></p></body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'x-tc-mw': 'preview' } });
}

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
  // Robô de prévia de link recebe o cartão; todo o resto recebe o redirect.
  // Response.redirect tem headers imutáveis; montamos à mão
  const resposta = PREVIEW_RE.test(req.headers.get('user-agent') || '') ? paginaPrevia() : new Response(null, {
    status: 307,
    headers: { Location: destino.toString(), 'x-tc-mw': '1' }, // x-tc-mw: diagnóstico (prova que o middleware respondeu)
  });

  try {
    if (!R_URL || !R_TOK) return resposta;
    const path = url.pathname;
    if (/\.[a-z0-9]{2,5}$/i.test(path)) return resposta; // favicon, imagens etc. não contam

    const ua = req.headers.get('user-agent') || '';
    const t = agora();
    const ns = t.dia < INICIO_OFICIAL ? 'rdteste:' : 'rd:';
    const dia = ns + 'd:' + t.dia; // hash do dia: campos "dimensao=valor" (é o que permite filtrar por período no painel)
    const cmds = [['INCR', ns + 'total'], ['SET', ns + 'last', t.iso]];

    let refHost = '';
    try { refHost = new URL(req.headers.get('referer') || '').hostname; } catch (e) {}
    const motivo = motivoRobo(ua, path, refHost);
    if (motivo) {
      cmds.push(['INCR', ns + 'bots']);
      cmds.push(['HINCRBY', ns + 'bots:motivo', motivo, 1]);
      cmds.push(['HINCRBY', dia, 'bot=' + motivo, 1]);
      if (motivo === 'varredura') {
        const p = path.toLowerCase().slice(0, 60);
        cmds.push(['HINCRBY', ns + 'bots:path', p, 1]);
        cmds.push(['HINCRBY', dia, 'botpath=' + p, 1]);
      }
    } else {
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
        city: g.city + '|' + g.region + '|' + g.country, // o painel formata ("Petrolina, PE" / "Miami, FL, EUA")
      };
      cmds.push(['INCR', ns + 'humanos']);
      cmds.push(['HINCRBY', ns + 'byday', t.dia, 1]);
      cmds.push(['HINCRBY', ns + 'byhour', t.hora, 1]);
      cmds.push(['HINCRBY', dia, 'hour=' + t.hora, 1]);
      for (const [k, v] of Object.entries(dims)) {
        if (!v) continue;
        cmds.push(['HINCRBY', ns + k, v, 1]);        // desde o início
        cmds.push(['HINCRBY', dia, k + '=' + v, 1]); // só este dia
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
