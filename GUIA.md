# REX - Center of Excellence · Guia de instalação

Este projeto é o sistema de controle das solicitações de dados do time. Ele tem duas telas:

- **REX** (`/`): painel do time. Exige login e cadastro prévio. Owner e admin veem tudo e configuram; viewer vê tudo e só muda o status das tarefas dele.
- **Formulário de solicitação** (`/solicitar`): público, sem login. Quem pede preenche e anexa arquivos.

Como as peças se conectam:

```
 navegador ──► Supabase  (login por código no e-mail, banco de dados, anexos, tempo real)
     │
     └──────► Vercel     (hospeda o site e a função /api/seatalk)
                  └────► SeaTalk Open Platform (bot ou webhook → mensagem para o solicitante / grupo)
```

Arquivos do projeto:

| Arquivo | O que é |
| --- | --- |
| `index.html` | O site inteiro (REX + formulário + login). Só precisa editar duas linhas (passo 2.6). |
| `banner.jpg` | Imagem do topo. |
| `api/seatalk.js` | Função serverless que envia as mensagens pelo SeaTalk sem expor segredos. |
| `supabase/schema.sql` | Cria tabelas, permissões, buckets de arquivos e funções no Supabase. |
| `vercel.json` | Faz `/solicitar` abrir o formulário e adiciona cabeçalhos de segurança. |
| `.env.example` | Lista das variáveis de ambiente da Vercel. |

Antes de configurar qualquer coisa, dá para ver tudo funcionando: abra `index.html` com dois cliques. Enquanto as chaves do Supabase não estiverem preenchidas, o site roda em **modo demonstração** com dados fictícios (a caixa no canto inferior esquerdo troca o perfil: owner, admin, viewer ou formulário).

---

## 1. O que você vai precisar

- Conta no [Supabase](https://supabase.com) (plano gratuito serve para começar).
- Conta no [GitHub](https://github.com) e na [Vercel](https://vercel.com) (entre na Vercel com o GitHub).
- Acesso ao SeaTalk Desktop para criar o webhook ou o bot (passo 5).
- Nenhum programa instalado: tudo é feito pelos sites.

Duas observações para um uso corporativo: o plano gratuito do Supabase pausa projetos sem acesso por 7 dias (com uso diário não acontece) e o plano Hobby da Vercel é para uso pessoal; para uso na empresa, verifique com a área responsável qual plano/infra usar. Os dados (e-mails de solicitantes, anexos) ficam no Supabase, então escolha a região e confira a política interna de dados.

---

## 2. Supabase (banco de dados e login)

### 2.1 Criar o projeto
1. Em supabase.com, **New project**. Dê um nome (ex.: `rex`), crie uma senha forte para o banco (guarde) e escolha a região mais próxima (South America, se disponível).
2. Aguarde 1–2 minutos até o projeto ficar pronto.

### 2.2 Criar as tabelas
1. No menu lateral, abra **SQL Editor** → **New query**.
2. Abra o arquivo `supabase/schema.sql`, copie todo o conteúdo e cole no editor.
3. **Importante:** role até o final do SQL (passo 9 do arquivo) e troque `SEU.EMAIL@shopee.com` e `Seu Nome` pelo seu e-mail corporativo e nome. Esse e-mail será o **owner**. Sem isso ninguém consegue entrar.
4. Clique em **Run**. Deve terminar com "Success". Pode rodar de novo quantas vezes quiser.

O que o SQL faz: cria `profiles` (quem entra), `tasks` (solicitações), `settings` (preferências/capacidade), `notifications` (histórico de envios), `avatars`; liga as regras de acesso por perfil; cria os buckets `anexos` e `avatares`; ativa o tempo real; e cria um gatilho que **só permite criar login para e-mails que estão em `profiles`**.

### 2.3 Login por código no e-mail
O REX usa o login por e-mail do Supabase: a pessoa digita o e-mail e recebe um código de 6 dígitos (também funciona clicando no link do e-mail).

1. **Authentication → Sign In / Providers → Email**: deixe **Enable email provider** ligado e mantenha **Allow new users to sign up** ligado (o gatilho do passo 2.2 é quem barra e-mails de fora; se você desligar isso, ninguém novo consegue entrar).
2. **Authentication → Emails (Templates)**: edite os modelos **Confirm sign up** e **Magic Link** e inclua o código no texto, por exemplo:
   ```html
   <h2>Seu código de acesso ao REX</h2>
   <p>Código: <strong>{{ .Token }}</strong></p>
   <p>Ou <a href="{{ .ConfirmationURL }}">clique aqui para entrar</a>.</p>
   ```
   (O primeiro acesso de uma pessoa usa o modelo *Confirm sign up*; os seguintes usam *Magic Link*. Por isso os dois.)
3. **Authentication → URL Configuration**: em **Site URL** coloque o endereço do site na Vercel (você terá no passo 4; pode voltar aqui depois) e em **Redirect URLs** adicione `https://SEU-SITE.vercel.app/**`. Para testar localmente, adicione também `http://localhost:*/**`.

### 2.4 E-mails de verdade (SMTP)
O servidor de e-mail padrão do Supabase é só para testes e manda pouquíssimas mensagens por hora. Com várias pessoas no time, configure um SMTP próprio em **Project Settings → Authentication → SMTP Settings** (qualquer provedor serve: Resend, Brevo, SendGrid ou o SMTP corporativo, se a TI liberar). Enquanto isso, teste com uma pessoa de cada vez.

### 2.5 Pegar as chaves
Em **Project Settings → API** (ou **API Keys**):
- **Project URL** → algo como `https://abcdefghijkl.supabase.co`
- **Publishable key** (em projetos antigos chama-se `anon` key) → pode ficar no HTML, é pública.
- **Secret key** (em projetos antigos `service_role`) → **nunca** no HTML; só na Vercel (passo 4.3).

### 2.6 Colocar as chaves no site
Abra `index.html` em qualquer editor de texto (Bloco de Notas serve) e, perto da linha 527, preencha:

```js
const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_...';   // ou a anon key
```

Salve. A partir daqui o modo demonstração desliga sozinho.

---

## 3. Testar antes de publicar

Abra `index.html` com dois cliques e tente entrar com o e-mail do owner. Você deve receber o código, entrar e ver o painel vazio. Abra o formulário pelo link "Preencha o formulário", envie uma solicitação de teste e veja ela aparecer no REX em tempo real.

Se o código não chegar: confira a caixa de spam, o modelo de e-mail (passo 2.3) e **Authentication → Users** (deve existir um usuário com o seu e-mail). Se aparecer "Este e-mail não tem acesso", o e-mail não está em `profiles`: volte ao passo 2.2, item 3.

Notificar pelo SeaTalk ainda não funciona nesse teste local, porque a função `/api/seatalk` só existe na Vercel.

---

## 4. Publicar na Vercel

### 4.1 Subir o código no GitHub
1. Em github.com, **New repository**, nome `rex`, **Private**, **Create repository**.
2. Na página do repositório, clique em **uploading an existing file** e arraste os arquivos e pastas do projeto (`index.html`, `banner.jpg`, `api/`, `supabase/`, `vercel.json`, `package.json`, `.env.example`, `.gitignore`, `GUIA.md`). **Commit changes**.

Depois, toda vez que você alterar um arquivo e subir de novo, a Vercel publica a nova versão sozinha.

### 4.2 Importar na Vercel
1. Em vercel.com, **Add New… → Project** → **Import** o repositório `rex`.
2. Framework Preset: **Other**. Não precisa de build command nem output directory. **Deploy**.
3. Ao terminar, você recebe um endereço como `https://rex-xxxx.vercel.app`.

### 4.3 Variáveis de ambiente
Em **Project → Settings → Environment Variables**, crie (nomes exatamente como em `.env.example`):

| Nome | Valor |
| --- | --- |
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_ANON_KEY` | publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret/service_role key |
| `SEATALK_WEBHOOK_URL` | webhook do grupo (passo 5A) – opcional |
| `SEATALK_APP_ID` / `SEATALK_APP_SECRET` | credenciais do bot (passo 5B) – opcional |

Depois de salvar, vá em **Deployments → ⋯ → Redeploy** para a função carregar as variáveis.

### 4.4 Fechar o ciclo com o Supabase
Volte em **Authentication → URL Configuration** e coloque o endereço da Vercel em **Site URL** e `https://SEU-SITE.vercel.app/**` em **Redirect URLs**.

Pronto: `https://SEU-SITE.vercel.app` é o REX e `https://SEU-SITE.vercel.app/solicitar` é o formulário (o botão **Copiar link do formulário** copia esse endereço).

---

## 5. SeaTalk (botão Notificar)

O botão **Notificar** fica dentro da solicitação (topo da gaveta e na seção "Notificações enviadas"). Ele abre os modelos prontos, preenchidos com os dados do projeto, e envia por um de três destinos. Você pode configurar um ou os dois caminhos abaixo; o pop-up mostra o que está disponível.

### 5A. Caminho rápido: webhook de grupo (destino "Canal do time")
Não precisa criar app nem pedir permissão. Serve para avisar um grupo onde o time e os solicitantes estão.

1. No **SeaTalk Desktop**, abra o grupo → configurações do grupo → **System Accounts** → **Add System Account** (quem não é dono do grupo precisa ser "account admin" do grupo).
2. Dê um nome (ex.: REX) e copie a URL do webhook: `https://openapi.seatalk.io/webhook/group/...`
3. Na Vercel, salve como `SEATALK_WEBHOOK_URL` e faça o redeploy.

A mensagem chega ao grupo com o número e o nome da solicitação e o e-mail do solicitante. Limite do SeaTalk: 60 mensagens por minuto por webhook.

### 5B. Bot (destinos "Solicitante" e "Grupo da solicitação")
Permite mensagem direta para quem pediu e mensagens em um grupo específico de cada solicitação.

1. Acesse https://open.seatalk.io (no desktop) e crie um **App** com a capacidade **Bot** ativada.
2. Em **Basic Info & Credentials**, copie **App ID** e **App Secret** → Vercel: `SEATALK_APP_ID` e `SEATALK_APP_SECRET`. Redeploy.
3. Em permissões, habilite: **Send Message to Bot Subscriber/User**, **Send Message to Group Chat** e **Get Employee Code with Email** (esta última costuma exigir aprovação do administrador do SeaTalk da empresa — é ela que converte o e-mail do solicitante em destinatário).
4. Coloque o app **Online**.
5. Mensagem direta só chega para quem **assinou** o bot: peça para os solicitantes abrirem o bot no SeaTalk e clicarem em *Subscribe*. Se não tiverem feito isso, o REX mostra o aviso "O destinatário ainda não assinou o bot".
6. Para o destino **Grupo da solicitação**: adicione o bot como membro do grupo no SeaTalk; no REX, abra a solicitação → **Notificar** → escolha "Grupo da solicitação" → **Listar grupos em que o bot está** → **Vincular à solicitação**. (Também dá para colar o ID em **Editar → ID do grupo no SeaTalk**.)

### 5C. Testar
Abra uma solicitação de teste, clique em **Notificar**, escolha um modelo, edite se quiser (trechos entre [colchetes] precisam ser preenchidos) e **Enviar pelo SeaTalk**. O resultado fica registrado em "Notificações enviadas", inclusive quando falha, com o motivo. Erros detalhados aparecem em **Vercel → Project → Logs**.

---

## 6. Dia a dia

- **Equipe** (aba visível para owner/admin): adicionar pessoas pelo e-mail corporativo. A pessoa entra com esse e-mail e recebe o código. Desativar alguém bloqueia o acesso na hora.
- **Configurações** (engrenagem no topo, owner/admin): limites de tasks de alta e média complexidade, total em aberto e o **Modo Burnout**. Quando um limite é ultrapassado ou o Burnout está ligado, aparece um chip ao lado do título e o formulário passa a avisar que os prazos podem se estender. O formulário só recebe um "sim/não" do banco, nunca os números do time.
- **Kanban**: arraste cartões entre colunas. Viewer só move as tarefas dele.
- **Prazos**: calculados pela complexidade (24h, 1 semana, 1 mês) e refeitos quando a complexidade muda.

---

## 7. Erros comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| "Este e-mail não tem acesso" ao pedir o código | E-mail não está em `profiles` | Owner adiciona na aba Equipe (ou ajuste o passo 2.2, item 3) |
| Código não chega | Limite do SMTP padrão ou spam | Passo 2.4 (SMTP próprio); confira a pasta de spam |
| Entra, mas a tela diz "Sem acesso" | Perfil desativado ou e-mail diferente do cadastrado | Reative na aba Equipe / confira o e-mail |
| Link do e-mail abre em "localhost" ou erro de redirect | URL não autorizada | Passo 2.3, item 3 (Redirect URLs) |
| Formulário não envia anexos | Bucket `anexos` não existe ou políticas não rodaram | Rode o `schema.sql` de novo |
| Notificar: "Função /api/seatalk indisponível" | Site aberto fora da Vercel (arquivo local) ou deploy antigo | Use o endereço da Vercel; faça redeploy |
| Notificar: "Defina SEATALK_… na Vercel" | Variável faltando | Passo 4.3 + redeploy |
| "O bot não tem permissão para esta ação" (103) | Permissão não habilitada/aprovada no SeaTalk | Passo 5B, item 3 |
| "O destinatário ainda não assinou o bot" (3002) | Solicitante não abriu o bot | Passo 5B, item 5, ou use o canal do time |
| Painel não atualiza sozinho | Tempo real desligado | Rode o bloco 8c do `schema.sql`; em **Database → Publications**, `supabase_realtime` deve incluir `tasks` e `settings` |

---

## 8. Próximo passo planejado: NPS pelo bot

O modelo "Pesquisa de satisfação (NPS)" já aparece no pop-up como *em breve*. Para ativar depois:

1. Criar a tabela `nps_responses` (`task_id`, `score` 0–10, `comment`, `token`, `answered_at`) e uma função `submit_nps(token, score, comment)` pública, igual à `capacity_status()`.
2. Criar a rota `/nps/<token>` no `index.html` com a tela de nota (0 a 10) e comentário.
3. Na função `/api/seatalk`, quando a tarefa virar **Concluído**, gerar o token e enviar o modelo de NPS com o link pelo mesmo bot.
4. Mostrar a média de NPS nos cards do painel.

Se mais tarde o time preferir entrar com a conta Google em vez do código por e-mail, basta ativar o provedor Google em **Authentication → Providers** e trocar a chamada `signInWithOtp` por `signInWithOAuth({provider:'google'})` no `index.html`; o resto (perfis, permissões) continua igual, porque tudo é amarrado pelo e-mail.
