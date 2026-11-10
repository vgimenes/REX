/**
 * REX - Center of Excellence :: limpeza diária de anexos (Vercel Cron)
 *
 * Todo dia (vercel.json → "crons"), a Vercel chama esta função. Ela procura solicitações
 * concluídas há mais de 30 dias que ainda têm anexos, apaga os arquivos pelo Storage API
 * do Supabase (apagar direto pelo SQL deixaria arquivos órfãos ocupando espaço), limpa a
 * lista de anexos da tarefa e marca attachments_purged_at. A tarefa em si continua no REX.
 *
 * Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e CRON_SECRET
 * (a Vercel envia "Authorization: Bearer <CRON_SECRET>" em cada execução agendada).
 * Teste manual: Vercel → Project → Settings → Cron Jobs → Run.
 */
'use strict';

const ENV = process.env;
const PURGE_DAYS = 30;
const BUCKET = 'anexos';
const BATCH = 200;

async function sb(path, opts = {}){
  const r = await fetch(`${ENV.SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: ENV.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const txt = await r.text();
  if(!r.ok) throw new Error(`Supabase ${r.status} em ${path.split('?')[0]}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if(!ENV.CRON_SECRET || req.headers.authorization !== `Bearer ${ENV.CRON_SECRET}`){
    return res.status(401).json({error: 'Não autorizado.'});
  }
  for(const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']){
    if(!ENV[k]) return res.status(500).json({error: `A variável ${k} não está definida na Vercel.`});
  }

  const cutoff = new Date(Date.now() - PURGE_DAYS * 864e5).toISOString();
  let tasksDone = 0, filesDone = 0;
  const errors = [];
  try{
    const rows = await sb(`/rest/v1/tasks?select=id,number,attachments&status=eq.concluida&completed_at=lt.${encodeURIComponent(cutoff)}&attachments_purged_at=is.null&order=completed_at.asc&limit=${BATCH}`);
    for(const t of rows || []){
      const paths = (Array.isArray(t.attachments) ? t.attachments : []).map(a => a && a.path).filter(Boolean);
      try{
        if(paths.length){
          // apaga pelo Storage API (mesmo endpoint usado por storage.from(bucket).remove(paths))
          await sb(`/storage/v1/object/${BUCKET}`, {method: 'DELETE', body: JSON.stringify({prefixes: paths})});
        }
        await sb(`/rest/v1/tasks?id=eq.${t.id}`, {
          method: 'PATCH',
          headers: {Prefer: 'return=minimal'},
          body: JSON.stringify({attachments: [], attachments_purged_at: new Date().toISOString()})
        });
        tasksDone++; filesDone += paths.length;
      }catch(err){
        errors.push(`#${t.number}: ${err.message}`);
      }
    }
    await sb('/rest/v1/settings?id=eq.1', {
      method: 'PATCH',
      headers: {Prefer: 'return=minimal'},
      body: JSON.stringify({last_cleanup_at: new Date().toISOString(), last_cleanup_files: filesDone})
    }).catch(err => errors.push('settings: ' + err.message));
  }catch(err){
    console.error('[api/cleanup]', err);
    return res.status(500).json({error: err.message});
  }
  if(errors.length) console.error('[api/cleanup] falhas:', errors);
  return res.status(errors.length ? 207 : 200).json({ok: !errors.length, cutoff, tasks: tasksDone, files: filesDone, errors});
};
