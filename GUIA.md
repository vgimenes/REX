# REX - Center of Excellence · Guia de instalação

Este projeto é o sistema de controle das solicitações de dados do time. Ele tem duas telas:

- **REX** (`/`): painel do time. Exige login e cadastro prévio. Owner e admin veem tudo e configuram; viewer vê tudo e só muda o status das tarefas dele.
- **Formulário de solicitação** (`/solicitar`): público, sem login. Quem pede preenche e anexa arquivos.

Como as peças se conectam:

```
 navegador ──► Supabase  (login por código no e-mail, banco de dados, anexos, tempo real)
     │
     └──────► Vercel     (hospeda o site e a função /api/seatalk)
                  └────► SeaTalk Open Platform (bot → mensagem direta para o solicitante)
```

Arquivos do projeto:

| Arquivo | O que é |
| --- | --- |
| `index.html` | O site inteiro (REX + formulário + login). Não tem nenhuma chave dentro; nada precisa ser editado. |
| `banner.jpg` | Imagem do topo. |
| `api/config.js` | Entrega à tela a URL e a chave pública do Supabase lidas das variáveis da Vercel. Nenhuma chave fica no HTML. |
| `api/seatalk.js` | Função serverless que envia as mensagens pelo SeaTalk sem expor segredos. |
| `api/cleanup.js` | Limpeza diária: apaga os anexos de solicitações concluídas há mais de 30 dias. |
| `supabase/schema.sql` | Cria tabelas, permissões, buckets de arquivos e funções no Supabase. |
| `vercel.json` | Faz `/solicitar` abrir o formulário e adiciona cabeçalhos de segurança. |
| `.env.example` | Lista das variáveis de ambiente da Vercel. |

Antes de configurar qualquer coisa, dá para ver tudo funcionando: abra `index.html` com dois cliques. Enquanto as chaves do Supabase não estiverem preenchidas, o site roda em **modo demonstração** com dados fictícios (a caixa no canto inferior esquerdo troca o perfil: owner, admin, viewer ou formulário).

---

## 1. O que você vai precisar

- Conta no [Supabase](https://supabase.com) (plano gratuito serve para começar).
- Conta no [GitHub](https://github.com) e na [Vercel](https://vercel.com) (entre na Vercel com o GitHub).
- Acesso ao open.seatalk.io para criar o bot (passo 5).
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

### 2.6 Onde as chaves ficam
Em lugar nenhum do código. As três chaves vão para as variáveis de ambiente da Vercel (passo 4.3): a tela busca a URL e a chave pública em `/api/config` ao abrir, e a função `/api/seatalk` usa a chave secreta. Se o site for publicado sem as variáveis, aparece a tela "Falta configurar o Supabase".

Vale ser claro sobre o que isso protege: a chave *publishable/anon* é pública por natureza, porque o navegador precisa dela para falar com o Supabase (ela aparece na aba Rede do navegador de qualquer visitante). O que protege os dados são as políticas de acesso do `schema.sql`. Tirá-la do HTML evita que fique no GitHub e permite trocar as chaves na Vercel sem mexer em código. A chave *secreta* nunca chega ao navegador.

### 2.7 Login com Google (opcional)
O botão **Entrar com Google** já está na tela de login (`const AUTH = {google: true, email: true}` no `index.html`). Para ele funcionar, o Supabase precisa de um cliente OAuth do Google. Quem pode entrar continua sendo decidido pela tabela `profiles`: uma conta Google que não está cadastrada vê "Este e-mail não tem acesso".

**No Google Cloud (console.cloud.google.com)**
1. Crie um projeto (ex.: `REX`). Se a Shopee usa Google Workspace e a TI puder criar o projeto dentro da organização, melhor: a tela de consentimento pode ser do tipo **Internal**, aceitando só contas da empresa. Senão, use sua conta e o tipo **External** (funciona igual, porque o Supabase barra quem não está em `profiles`).
2. **APIs e serviços → Tela de consentimento OAuth** (no console novo: **Google Auth Platform → Branding/Audience**): nome do app "REX - Center of Excellence", e-mail de suporte e de contato. Escopos: deixe os padrões (e-mail, perfil, openid). Se for External, em **Audience** clique em **Publish app** para sair do modo de teste; sem isso só as contas listadas como "test users" conseguem entrar.
3. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**, nome `REX`:
   - Origens JavaScript autorizadas: `https://SEU-SITE.vercel.app`
   - URIs de redirecionamento autorizados: `https://SEU-PROJETO.supabase.co/auth/v1/callback` (copie exatamente da tela do provedor Google no Supabase, item abaixo).
4. Salve e copie o **ID do cliente** e a **Chave secreta do cliente**.

**No Supabase**
5. **Authentication → Sign In / Providers → Google**: ligue, cole o Client ID e o Client Secret, salve. Nessa tela aparece a URL de callback usada no item 3.
6. Confira **Authentication → URL Configuration**: Site URL e Redirect URLs com o endereço da Vercel (`https://SEU-SITE.vercel.app/**`).

**Detalhes**
- O login com Google só funciona no site publicado (https), não abrindo o `index.html` do computador. Para testar antes, o código por e-mail continua disponível.
- `GOOGLE_HD = 'shopee.com'` no `index.html` faz a tela do Google já sugerir a conta da empresa. Deixe `''` para não filtrar.
- Quem já entrava por código e passa a usar o Google com o mesmo e-mail cai na mesma conta; nada muda nas tarefas atribuídas.
- Para deixar **só** o Google, use `const AUTH = {google: true, email: false}`.

---

## 3. Testar antes de publicar

Abrindo `index.html` com dois cliques você vê o site em modo demonstração, com dados fictícios: serve para conhecer as telas e mostrar para o time, mas não usa o banco. O primeiro teste de verdade acontece depois do passo 4.4, no endereço da Vercel: entre com o e-mail do owner, receba o código, veja o painel vazio, abra o formulário e envie uma solicitação de teste. Ela deve aparecer no REX em tempo real.

Se o código não chegar: confira a caixa de spam, o modelo de e-mail (passo 2.3) e **Authentication → Users** (deve existir um usuário com o seu e-mail). Se aparecer "Este e-mail não tem acesso", o e-mail não está em `profiles`: volte ao passo 2.2, item 3.

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
| `SUPABASE_URL` | Project URL do Supabase (obrigatória: a tela usa) |
| `SUPABASE_ANON_KEY` | publishable/anon key (obrigatória: a tela usa) |
| `SUPABASE_SERVICE_ROLE_KEY` | secret/service_role key (só as funções do SeaTalk e da limpeza) |
| `CRON_SECRET` | um texto aleatório de 16+ caracteres que você inventa; protege a limpeza diária (passo 6) |
| `SEATALK_APP_ID` / `SEATALK_APP_SECRET` | credenciais do bot (passo 5.2) |

Depois de salvar, vá em **Deployments → ⋯ → Redeploy**: as variáveis só entram em vigor em um deploy novo. Sem `SUPABASE_URL` e `SUPABASE_ANON_KEY` o site abre na tela "Falta configurar o Supabase".

### 4.4 Fechar o ciclo com o Supabase
Volte em **Authentication → URL Configuration** e coloque o endereço da Vercel em **Site URL** e `https://SEU-SITE.vercel.app/**` em **Redirect URLs**.

Pronto: `https://SEU-SITE.vercel.app` é o REX e `https://SEU-SITE.vercel.app/solicitar` é o formulário (o botão **Copiar link do formulário** copia esse endereço).

---

## 5. SeaTalk (botão Notificar)

O botão **Notificar** (topo da gaveta da solicitação e seção "Notificações enviadas") abre a janela de envio. A mensagem vai sempre direto para o SeaTalk do solicitante, enviada pelo bot do time. A janela também abre sozinha quando owner ou admin avança uma solicitação no processo (por exemplo, de *Em análise* para *Em andamento*, pela lista, pelo kanban ou pela edição), já com o modelo **Atualização** preenchido; é só revisar e enviar, ou clicar em *Agora não*. Voltar uma etapa não abre a janela.

Na lista lateral fica o modelo padrão **Atualização** e os templates do time. **Adicionar template** abre um editor com nome, texto e botões para inserir variáveis (número, nome do projeto, status, prazo, responsável…), com uma prévia de como a mensagem fica naquela solicitação. Templates do time podem ser editados ou excluídos pelo botão *Editar template*; ficam salvos no banco e aparecem para todos os owners e admins.

### 5.1 Conferir a configuração
Abra `https://SEU-SITE.vercel.app/api/seatalk`. A resposta `{"dm":true}` significa que o bot está configurado; `{"dm":false}` significa que faltam as variáveis do passo 5.2.

### 5.2 Criar e configurar o bot
1. Acesse https://open.seatalk.io com a conta da empresa → **Create App**, nome `REX`.
2. Ative a capacidade **Bot**.
3. Em **Basic Info & Credentials**, copie **App ID** e **App Secret** → Vercel: `SEATALK_APP_ID` e `SEATALK_APP_SECRET` → Save → Redeploy.
4. Em permissões, solicite **Send Message to Bot Subscriber** e **Get Employee Code with Email** (a segunda converte o e-mail do solicitante em destinatário e pode depender de aprovação do admin do SeaTalk).
5. Em disponibilidade/alcance do app, deixe **todos os funcionários**. Quem estiver fora do alcance não recebe mensagens e nem encontra o bot.
6. Publique o app (**Online**).
7. Os solicitantes precisam **assinar o bot** uma vez: no SeaTalk, *Bots* → `REX` → **Subscribe**. Vale incluir isso na divulgação do formulário.

### 5.3 Diagnosticar
O resultado de cada envio fica em "Notificações enviadas" dentro da solicitação, inclusive quando falha, com o motivo. Detalhes técnicos: **Vercel → Project → Logs**, função `/api/seatalk`.

| Mensagem no REX | Causa | O que fazer |
| --- | --- | --- |
| A função /api/seatalk não respondeu | Site aberto fora da Vercel ou deploy antigo | Use o endereço da Vercel; redeploy |
| O bot do SeaTalk não está configurado | Faltam `SEATALK_APP_ID`/`SEATALK_APP_SECRET` ou o redeploy | Passo 5.2, item 3 |
| O bot não tem permissão para esta ação (103) | Permissão não aprovada | Passo 5.2, item 4 |
| O app do SeaTalk não está online (105) | App não publicado | Passo 5.2, item 6 |
| O SeaTalk não reconhece este solicitante… (3001) | Solicitante fora do alcance do bot, ou e-mail diferente do usado no SeaTalk | Passo 5.2, item 5; confira o e-mail |
| O destinatário ainda não assinou o bot (3002) | Solicitante não assinou | Passo 5.2, item 7 |
| Não encontrei … no SeaTalk | E-mail não existe no diretório | Corrija o e-mail em **Editar** |

---

## 6. Dia a dia

- **Equipe** (aba visível para owner/admin): adicionar pessoas pelo e-mail corporativo. A pessoa entra com esse e-mail e recebe o código. Desativar alguém bloqueia o acesso na hora.
- **Configurações** (engrenagem no topo, owner/admin): limites de tasks de alta e média complexidade, total em aberto e o **Modo Burnout**. Quando um limite é ultrapassado ou o Burnout está ligado, aparece um chip ao lado do título e o formulário passa a avisar que os prazos podem se estender. O formulário só recebe um "sim/não" do banco, nunca os números do time.
- **Armazenamento** (Configurações → Armazenamento): barras com o espaço usado do banco de dados e dos arquivos (anexos e fotos) em relação aos limites do plano gratuito (500 MB de banco e 1 GB de arquivos), com o detalhe por pasta e por tabela. Os números vêm da função `storage_usage()` do `schema.sql`; se a aba disser que a função não existe, rode o `schema.sql` de novo.
- **Limpeza automática de anexos**: todo dia, por volta das 03h (06:00 UTC, agendado em `vercel.json`), a função `api/cleanup.js` apaga os anexos das solicitações concluídas há mais de 30 dias. A solicitação continua no REX, com o aviso "Anexo removido automaticamente em …". Para ativar: crie a variável `CRON_SECRET` na Vercel (qualquer texto aleatório com 16+ caracteres) e faça um redeploy. Para testar sem esperar: **Vercel → Project → Settings → Cron Jobs → Run**. A data e a quantidade da última execução aparecem na aba Armazenamento. Se uma solicitação concluída for reaberta depois disso, o anexo não volta.
- **Formulário**: aceita 1 arquivo de até 20 MB. Quem precisar mandar vários pode juntar em um `.zip`.
- **Kanban**: arraste cartões entre colunas. Viewer só move as tarefas dele.
- **Prazos**: calculados pela complexidade (24h, 1 semana, 1 mês) e refeitos quando a complexidade muda.

---

## 7. Erros comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Site na Vercel mostra "Falta configurar o Supabase" | `SUPABASE_URL` / `SUPABASE_ANON_KEY` não estão nas variáveis da Vercel, ou o deploy é anterior a elas | Passo 4.3 e redeploy; depois Ctrl+F5 |
| "Este e-mail não tem acesso" ao pedir o código ou ao voltar do Google | E-mail não está em `profiles` | Owner adiciona na aba Equipe (ou ajuste o passo 2.2, item 3) |
| Google: "redirect_uri_mismatch" | URI de callback diferente no Google Cloud | Passo 2.7, item 3: cole a URL exata do provedor Google do Supabase |
| Google: "access blocked / app não verificado" para colegas | Consentimento External ainda em modo de teste | Passo 2.7, item 2: Publish app (ou adicione a pessoa como test user) |
| Código não chega | Limite do SMTP padrão ou spam | Passo 2.4 (SMTP próprio); confira a pasta de spam |
| Entra, mas a tela diz "Sem acesso" | Perfil desativado ou e-mail diferente do cadastrado | Reative na aba Equipe / confira o e-mail |
| Link do e-mail abre em "localhost" ou erro de redirect | URL não autorizada | Passo 2.3, item 3 (Redirect URLs) |
| Formulário não envia anexos | Bucket `anexos` não existe ou políticas não rodaram | Rode o `schema.sql` de novo |
| "O bot não tem permissão para esta ação" (103) | Permissão não habilitada/aprovada no SeaTalk | Passo 5.2, item 4 |
| "O destinatário ainda não assinou o bot" (3002) | Solicitante não assinou o bot | Passo 5.2, item 7 |
| Painel não atualiza sozinho | Tempo real desligado | Rode o bloco 8c do `schema.sql`; em **Database → Publications**, `supabase_realtime` deve incluir `tasks` e `settings` |

---

## 8. Próximo passo planejado: NPS pelo bot

O modelo "Pesquisa de satisfação (NPS)" já aparece no pop-up como *em breve*. Para ativar depois:

1. Criar a tabela `nps_responses` (`task_id`, `score` 0–10, `comment`, `token`, `answered_at`) e uma função `submit_nps(token, score, comment)` pública, igual à `capacity_status()`.
2. Criar a rota `/nps/<token>` no `index.html` com a tela de nota (0 a 10) e comentário.
3. Na função `/api/seatalk`, quando a tarefa virar **Concluído**, gerar o token e enviar o modelo de NPS com o link pelo mesmo bot.
4. Mostrar a média de NPS nos cards do painel.

