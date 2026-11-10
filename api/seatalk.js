/**
 * REX - Center of Excellence :: função serverless da Vercel que envia notificações pelo SeaTalk.
 *
 * Ela existe por um motivo de segurança: o App Secret do bot nunca pode ficar no HTML.
 * O navegador chama esta função; ela confere quem está logado (token do Supabase),
 * confirma que é owner/admin, envia a mensagem e registra o histórico na tabela notifications.
 *
 * Rotas
 *   GET  /api/seatalk                → quais canais estão configurados (não expõe segredos)
 *   GET  /api/seatalk?action=groups  → grupos do SeaTalk em que o bot está (exige login de owner/admin)
 *   POST /api/seatalk                → envia a mensagem (exige login de owner/admin)
 *
 * Variáveis de ambiente (Vercel → Settings → Environment Variables), veja .env.example
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   SEATALK_APP_ID, SEATALK_APP_SECRET   → bot criado em open.seatalk.io (mensagem direta e grupo)
 *   SEATALK_WEBHOOK_URL                  → webhook de um "System Account" de grupo (canal do time)
 *
 * Referência da API: https://open.seatalk.io  (base https://openapi.seatalk.io)
 */
'use strict';

const ENV = process.env;
const SEATALK = 'https://openapi.seatalk.io';
const hasBot = () => !!(ENV.SEATALK_APP_ID && ENV.SEATALK_APP_SECRET);

class HttpError extends Error {
  constructor(status, message){ super(message); this.status = status; }
}

/* Mensagens em português para os códigos de erro do SeaTalk Open Platform */
const SEATALK_ERRORS = {
  100: 'Token do bot expirado ou inválido. Tente de novo em instantes.',
  101: 'O SeaTalk limitou a quantidade de chamadas. Aguarde um minuto e tente de novo.',
  102: 'O SeaTalk recusou o conteúdo da mensagem (corpo inválido).',
  103: 'O bot não tem permissão para esta ação. Em open.seatalk.io, habilite a permissão correspondente (enviar mensagem ao usuário/grupo ou obter employee code por e-mail).',
  104: 'A capacidade "Bot" está desligada no app do SeaTalk.',
  105: 'O app do SeaTalk não está online. Publique-o em open.seatalk.io.',
  1000: 'App Secret do SeaTalk inválido. Confira SEATALK_APP_SECRET na Vercel.',
  3000: 'Nenhum usuário do SeaTalk com este e-mail. Confira se o e-mail do solicitante é o mesmo cadastrado no SeaTalk (um e-mail fictício não funciona).',
  3001: 'O SeaTalk não encontrou nenhum funcionário com o e-mail do solicitante. Confira se é o mesmo e-mail usado no SeaTalk (um e-mail fictício não funciona).',
  3002: 'O destinatário ainda não assinou o bot. Peça para ele abrir o bot no SeaTalk e clicar em "Subscribe"; depois envie de novo.',
  3003: 'O destinatário não está logado no SeaTalk.',
  4000: 'Tipo de mensagem inválido.'
};
const seatalkMsg = (code, fallback) => SEATALK_ERRORS[code] || `${fallback} (código ${code === undefined ? 'desconhecido' : code}).`;

/* ---------------- Supabase (REST, sem dependências) ---------------- */
async function sbUser(token){
  if(!token) throw new HttpError(401, 'Faça login no REX para enviar notificações.');
  const r = await fetch(`${ENV.SUPABASE_URL}/auth/v1/user`, {
    headers: {apikey: ENV.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`}
  });
  if(!r.ok) throw new HttpError(401, 'Sessão expirada. Recarregue a página e entre de novo.');
  return r.json();
}

async function sbRest(path, opts = {}){
  const r = await fetch(`${ENV.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: ENV.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(opts.headers || {})
    }
  });
  if(!r.ok) throw new HttpError(500, `O Supabase respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function requireManager(req){
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const user = await sbUser(token);
  const email = String(user.email || '').toLowerCase();
  const rows = await sbRest(`profiles?select=id,name,role,active&email=eq.${encodeURIComponent(email)}&limit=1`);
  const me = rows && rows[0];
  if(!me || !me.active) throw new HttpError(403, 'Seu e-mail não está cadastrado no REX.');
  if(!['owner', 'admin'].includes(me.role)) throw new HttpError(403, 'Só owner e admin podem enviar notificações.');
  return {...me, email};
}

const logNotification = row => sbRest('notifications', {method: 'POST', body: JSON.stringify(row)});

/* ---------------- SeaTalk ---------------- */
let tokenCache = {value: null, exp: 0};

async function appToken(){
  if(!hasBot()) throw new HttpError(500, 'Bot do SeaTalk não configurado. Defina SEATALK_APP_ID e SEATALK_APP_SECRET na Vercel.');
  if(tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const r = await fetch(`${SEATALK}/auth/app_access_token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({app_id: ENV.SEATALK_APP_ID, app_secret: ENV.SEATALK_APP_SECRET})
  });
  const j = await r.json().catch(() => ({}));
  if(!r.ok || j.code !== 0 || !j.app_access_token) throw new HttpError(502, seatalkMsg(j.code, 'Não foi possível autenticar o bot no SeaTalk'));
  // o token vale ~7200 s; renovamos 5 min antes
  tokenCache = {value: j.app_access_token, exp: Date.now() + Math.max(60, (Number(j.expire) || 7200) - 300) * 1000};
  return j.app_access_token;
}

async function seatalk(path, body, method = 'POST'){
  const token = await appToken();
  const r = await fetch(SEATALK + path, {
    method,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if(j.code === 100) tokenCache = {value: null, exp: 0}; // token expirou: a próxima chamada renova
  if(!r.ok || j.code !== 0) throw new HttpError(502, seatalkMsg(j.code, `O SeaTalk recusou a chamada ${path}`));
  return j;
}

const textMessage = content => ({tag: 'text', text: {content}});

async function employeeCode(email){
  const j = await seatalk('/contacts/v2/get_employee_code_with_email', {emails: [email]});
  const list = j.employees || j.results || j.data || [];
  const hit = Array.isArray(list)
    ? list.find(e => String(e.email || e.company_email || '').toLowerCase() === email && e.employee_code && e.exists !== false)
    : null;
  if(!hit) throw new HttpError(404, `Não encontrei ${email} no SeaTalk. Confira se o e-mail do solicitante é o mesmo cadastrado no SeaTalk.`);
  return hit.employee_code;
}

async function sendDM(email, content){
  const code = await employeeCode(email);
  await seatalk('/messaging/v2/single_chat', {employee_code: code, message: textMessage(content)});
  return email;
}

async function sendGroup(groupId, content){
  await seatalk('/messaging/v2/group_chat', {group_id: groupId, message: textMessage(content)});
  return groupId;
}

async function sendWebhook(content){
  if(!ENV.SEATALK_WEBHOOK_URL) throw new HttpError(500, 'Webhook não configurado. Defina SEATALK_WEBHOOK_URL na Vercel.');
  const r = await fetch(ENV.SEATALK_WEBHOOK_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(textMessage(content))
  });
  const j = await r.json().catch(() => ({}));
  if(!r.ok || (j.code !== undefined && j.code !== 0)) throw new HttpError(502, `O webhook do SeaTalk recusou a mensagem${j.code ? ` (código ${j.code})` : ''}. Confira SEATALK_WEBHOOK_URL.`);
  return 'canal do time';
}

async function listGroups(){
  const ids = [];
  let cursor = '';
  for(let i = 0; i < 10; i++){
    const q = new URLSearchParams({page_size: '50'});
    if(cursor) q.set('cursor', cursor);
    const j = await seatalk('/messaging/v2/group_chat/joined?' + q, null, 'GET');
    ids.push(...((j.joined_group_chats && j.joined_group_chats.group_ids) || j.group_ids || []));
    cursor = j.next_cursor || '';
    if(!cursor) break;
  }
  const out = [];
  for(const id of ids.slice(0, 50)){
    let name = '';
    try{
      const info = await seatalk('/messaging/v2/group_chat/info?' + new URLSearchParams({group_id: id}), null, 'GET');
      const g = info.group || info.group_chat || info;
      name = g.group_name || g.name || '';
    }catch(e){ /* nome é opcional */ }
    out.push({id, name});
  }
  return out;
}

/* ---------------- handler ---------------- */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try{
    if(req.method === 'GET'){
      if(req.query && req.query.action === 'groups'){
        await requireManager(req);
        return res.status(200).json({groups: await listGroups()});
      }
      return res.status(200).json({dm: hasBot(), group: hasBot(), webhook: !!ENV.SEATALK_WEBHOOK_URL});
    }
    if(req.method !== 'POST'){
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({error: 'Método não permitido.'});
    }
    for(const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']){
      if(!ENV[k]) throw new HttpError(500, `A variável ${k} não está definida na Vercel.`);
    }

    const me = await requireManager(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const {task_id, target = 'dm'} = body;
    const template = String(body.template || 'recado').slice(0, 40);
    const content = String(body.text || '').trim();

    if(!task_id || !/^[0-9a-f-]{36}$/i.test(task_id)) throw new HttpError(400, 'Solicitação inválida.');
    if(!['dm', 'group', 'webhook'].includes(target)) throw new HttpError(400, 'Destino inválido.');
    if(!content) throw new HttpError(400, 'A mensagem está vazia.');
    if(content.length > 3500) throw new HttpError(400, 'A mensagem é longa demais (máximo de 3.500 caracteres).');

    const rows = await sbRest(`tasks?select=id,number,name,requester_email,seatalk_group_id&id=eq.${task_id}&limit=1`);
    const task = rows && rows[0];
    if(!task) throw new HttpError(404, 'Solicitação não encontrada.');

    const intended = target === 'dm' ? task.requester_email : target === 'group' ? task.seatalk_group_id : 'canal do time';
    let recipient;
    try{
      if(target === 'dm') recipient = await sendDM(String(task.requester_email).toLowerCase(), content);
      else if(target === 'group'){
        if(!task.seatalk_group_id) throw new HttpError(400, 'Esta solicitação não tem um grupo do SeaTalk vinculado.');
        recipient = await sendGroup(task.seatalk_group_id, content);
      }
      else recipient = await sendWebhook(`#${task.number} · ${task.name}\nSolicitante: ${task.requester_email}\n\n${content}`);
    }catch(err){
      await logNotification({task_id, template, channel: target, recipient: intended, content, status: 'failed', error: err.message, sent_by: me.email}).catch(() => {});
      throw err;
    }
    await logNotification({task_id, template, channel: target, recipient, content, status: 'sent', sent_by: me.email}).catch(() => {});
    return res.status(200).json({ok: true, channel: target, recipient});
  }catch(err){
    const status = err.status || 500;
    if(status >= 500) console.error('[api/seatalk]', err);
    return res.status(status).json({error: err.message || 'Erro inesperado.'});
  }
};
