/**
 * REX - Center of Excellence :: configuração pública da tela, lida das variáveis de ambiente da Vercel.
 *
 * O navegador precisa da URL e da chave PUBLICÁVEL (publishable/anon) do Supabase para falar com o banco
 * diretamente; essa chave é pública por natureza, e o que protege os dados são as políticas RLS do
 * schema.sql. Servi-la por aqui tira as chaves do index.html e do GitHub e permite trocá-las na Vercel
 * sem editar código. A chave secreta (service_role) NUNCA passa por esta função.
 */
'use strict';

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY || ''
  });
};
