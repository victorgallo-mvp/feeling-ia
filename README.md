# Cockpit Feeling

Painel interno de geração de documentos. É só a fachada: a lógica de IA/dados vive no n8n.

```
frontend (Vercel)  →  backend (Railway)  →  webhooks n8n  → { markdown }
                          ├── Postgres do cérebro: lê `clientes`, grava `documentos_gerados`
                          └── Puppeteer: markdown → PDF → STORAGE_DIR
```

## Rodar local

```bash
# backend
cd backend
cp .env.example .env      # preencha DATABASE_URL e N8N_WEBHOOK_RELATORIO
npm install
npm run dev               # http://localhost:3000  (cria documentos_gerados no boot)

# frontend
cd frontend
cp .env.example .env      # VITE_API_URL=http://localhost:3000
npm install
npm run dev               # http://localhost:5173
```

## Deploy

**Backend — Railway** (mesmo projeto do Postgres)
- Root directory: `backend` (o `Dockerfile` instala o Chromium que o Puppeteer usa).
- Variáveis: `DATABASE_URL` (referência ao Postgres), `N8N_WEBHOOK_*`, `STORAGE_DIR=/data/pdfs`, `CORS_ORIGIN=<url da Vercel>`.
- Volume montado em `/data` — sem ele os PDFs somem a cada deploy.

**Frontend — Vercel**
- Root directory: `frontend`. Variável: `VITE_API_URL=<url do backend>`.

## Estado

- [x] Passo 1 — backend: clientes, gerar relatório, documentos, download
- [x] Passo 2 — frontend: lista → cliente → Gerar Relatório → download
- [x] Passo 3 — fim-a-fim com cliente real (Alemão Performance) + webhook real `relatorio-semanal`
- [x] Passo 4 — pesquisa, briefing e upload (PDF, DOCX, TXT até 25 MB; só alimenta o cérebro, não entra na lista)
- [x] Cadastro pelo painel — criar/editar cliente (`POST /api/clientes`, `PUT /api/clientes/:id`) e coluna `clientes.perfil`
- [x] Presença digital — campos `instagram`, `site`, `google_ads_id` + documento `analise` (webhook `N8N_WEBHOOK_PRESENCA`; sem ele o botão fica "em breve")
- [x] Deploy — Railway (backend) + Vercel (frontend)

## Documentos gerados

Cada documento tem um `estado`: `ok` (PDF no storage), `regeneravel` (PDF sumiu num deploy sem volume, mas o `markdown` está no banco — o download regenera) ou `perdido` (sem PDF e sem texto). A tela filtra por tipo, marca o mais recente de cada tipo, exclui um a um (`DELETE /api/documentos/:id`) e remove os perdidos de uma vez (`DELETE /api/clientes/:id/documentos/perdidos`).

## Reuniões

`POST /api/clientes/:id/reunioes` (multipart: `arquivo` TXT/MD/DOCX/PDF, `titulo`, `data_reuniao` opcionais) → o cockpit extrai o texto, o n8n (`N8N_WEBHOOK_REUNIAO`) devolve `{ markdown, sugestoes }` → vira documento `reuniao` (PDF + markdown + `extras`), só o resumo é indexado no cérebro (`tipo: reuniao`), a transcrição bruta fica no storage (`GET /api/documentos/:id/transcricao`). As sugestões de cadastro são aplicadas pela pessoa (`PUT /api/clientes/:id`) e registradas em `PATCH /api/documentos/:id/sugestoes`.

## Sugestões de cadastro

Cadastro assistido: "Novo cliente" recebe nome + arquivos (transcrição de reunião → `POST /reunioes`; documentos → `POST /anexar` com extração); o formulário abre pré-preenchido com as sugestões mescladas e a pessoa revisa e salva (`PUT /clientes/:id`), marcando as sugestões como aplicadas.

Upload (`POST /api/clientes/:id/anexar`, multipart `arquivo`) aceita `tipo` = `anexo` (padrão) ou `relatorio_semanal` e `titulo` opcional. Relatórios semanais entram no cérebro como histórico de desempenho e nunca geram sugestões de cadastro (números da semana não são perfil).

Duas origens, mesmo painel em "Informações do cliente": reuniões (`documentos_gerados.extras.sugestoes`) e anexos (`clientes.extras.sugestoes[]`, gerado no upload quando `extrair` ≠ false — o mesmo workflow de reunião em `modo: documento`). A pessoa aplica item a item (`PUT /api/clientes/:id`) e o cockpit registra em `PATCH /api/documentos/:id/sugestoes` ou `PATCH /api/clientes/:id/sugestoes/:sid`.

## Exclusões

- `DELETE /api/clientes/:id/anexos?titulo=...` tira um arquivo do cérebro (todos os chunks daquele título).
- `DELETE /api/clientes/:id` apaga o cliente, os documentos gerados (+ PDFs) e tudo que ele tem no cérebro. A tela pede o nome do cliente para confirmar; `GET /api/clientes/:id/resumo-exclusao` mostra as contagens antes.

## Onde cada informação do cliente mora

| Informação | Onde | Quem lê |
|---|---|---|
| nome, setor, cidade, `conta_id` | colunas de `clientes` | n8n por SQL (valor exato) |
| `instagram` (handle sem @), `site` (com https://), `google_ads_id` (123-456-7890) | colunas de `clientes` | vão no corpo de todo webhook de geração |
| perfil (público, diferenciais, ticket…) | `clientes.perfil` (texto, editar substitui) | n8n injeta direto no prompt de pesquisa/briefing |
| abrangência (`local`/`regional`/`nacional`, vazio = IA infere) | `clientes.abrangencia` | define onde a pesquisa busca concorrentes e mercado |
| orientações para a IA (foco do momento, o que evitar, tom) | `clientes.orientacoes` (até 1.500 caracteres) | bloco fixo "Orientações da equipe" nos 4 workflows — nunca vai pro cérebro |
| documentos longos (PDF/DOCX/TXT) | tabela `cerebro` via upload (metadata `cliente_id`, `titulo`, `tipo` — o webhook aceita `tipo`, padrão `anexo`) | n8n por busca semântica filtrada por `cliente_id` |

Todo webhook de geração recebe `cliente_id`; os workflows do n8n resolvem o cliente por ele (fallback: nome). O cérebro é filtrado por `metadata.cliente_id`.

`conta_id` tem que ser idêntico ao do Sentinel (`metricas_serie_temporal.conta_id`): valor errado não dá erro, o relatório só sai sem números.

## Geração assíncrona

`POST /api/clientes/:id/gerar/:tipo` responde **202** na hora com o documento em `estado: "gerando"`. O cockpit manda ao webhook, além dos dados do cliente, `documento_id`, `callback_url` e `callback_token`; o workflow responde `{ "aceito": true }` imediatamente e, ao terminar, faz `POST callback_url` com header `X-Cockpit-Token` e corpo `{ "markdown": "..." }` (ou `{ "erro": "..." }`). O cockpit gera o PDF e marca `ok`/`erro`; sem callback em 12 minutos vira `erro`. A tela consulta a lista a cada 5s enquanto houver documento gerando. Compatibilidade: se o webhook responder `{ markdown }` direto (modo antigo), o cockpit também conclui.

## Contrato dos webhooks de geração

`POST` com JSON; o workflow responde `{ "markdown": "..." }` em até 120s.

```json
{ "conta_id": "alemao-performance", "cliente_nome": "Alemão Performance", "cliente_id": 1,
  "instagram": "alemaoperformance", "site": "https://alemaoperformance.com.br", "google_ads_id": null }
```

Campos não preenchidos chegam como `null`. `GET /api/tipos` diz quais documentos têm webhook configurado.

## Aba Comercial (WhatsApp)

Para clientes com WhatsApp + IA (Evolution/Olívia) ligado ao cockpit. O workflow do n8n "Comercial — Classificar Conversas" lê o banco do WhatsApp do cliente (credencial própria), calcula por lead origem (anúncio via `anuncio_origem`), mensagens por autor (lead / IA / humano — humano = `assistant` com prefixo `[DIRETO]`), tempo até a 1ª resposta humana e "esperando resposta há X h", classifica com Claude (etapa, interesse, operação, objeção, próximo passo, nota do atendimento) e grava em `leads_comercial` no Postgres do cérebro. O cockpit só lê (`GET /api/clientes/:id/comercial?dias=7|30|90`) e dispara a rodada (`POST .../comercial/classificar` → webhook `N8N_WEBHOOK_COMERCIAL` → callback `POST .../comercial/concluir` com `X-Cockpit-Token`; estado em `clientes.extras.comercial`, incluindo a conciliação com o Meta vinda do Sentinel). A aba só aparece para clientes com `whatsapp_ativo` marcado na ficha; `whatsapp_webhook` (opcional) aponta para a cópia do workflow daquele cliente (cada banco do WhatsApp tem a sua credencial no n8n); sem ele, vale `N8N_WEBHOOK_COMERCIAL`. A rodada diária (06:30) cobre todos os clientes ativos e precisa de `PUBLIC_URL`.

## Análise interna da conta (tipo `interno`)

Documento de uso interno (não vai ao cliente), gerado como os outros (`POST /api/clientes/:id/gerar/interno`, webhook `N8N_WEBHOOK_INTERNO`, assíncrono com callback). O workflow lê o Sentinel por campanha (semana fechada, 3 semanas anteriores, 30 dias) e por anúncio (top por gasto, semana atual e anterior), aplica uma triagem determinística (semáforo por regras: sem resultado, custo por resultado subiu, resultados caíram, frequência alta, CTR abaixo da mediana, "estrela") e o Claude escreve veredito, triagem, leitura geral, cruzamento comercial × mídia (quando o cliente tem WhatsApp ligado), metas e prioridades do gestor. Exige `conta_id`.

## Gravações de reunião (áudio/vídeo)

"Reuniões" e o cadastro assistido aceitam MP3, M4A, WAV, OGG, MP4, WEBM… (até 300 MB). O cockpit converte para mono 16 kHz (ffmpeg, no Dockerfile), corta em trechos de 10 min e manda cada um ao webhook `N8N_WEBHOOK_TRANSCREVER` (workflow "Transcrever Áudio": OpenAI Whisper via crédito do n8n, pt), junta o texto e segue o mesmo fluxo da transcrição em texto. A transcrição fica guardada em `extras.transcricao`; `extras.trechos_audio` registra em quantas partes foi.

## Criativos

Seção "Criativos" na página do cliente. **A copy vem primeiro**, escrita a partir do material da conta, e cada copy aprovada vira um criativo próprio — a variação nasce do ângulo da copy, não de sortear imagens.

Fluxo, com aprovação humana entre as etapas:

1. **Contexto** (objetivo, produto, oferta, público, formato, direção visual, até 3 fotos do produto) → `POST /api/clientes/:id/criativos`.
2. **Copy** (`N8N_WEBHOOK_CRIATIVO_COPY`, assíncrono com callback `POST .../copy/concluir`): o cockpit junta o documento mais recente de cada tipo em `documentos_gerados` — briefing (6 mil caracteres), análise de presença (6 mil), reunião (6 mil) e pesquisa de mercado (9 mil) — e o n8n soma a isso os anexos do cliente no cérebro por busca semântica (`tipo` ≠ `relatorio_semanal`: número de campanha não é argumento de anúncio). Devolve 3 versões, cada uma com ângulo, headline, texto de apoio, CTA, legenda, racional e a **direção de imagem** que a arte precisa. As fontes usadas voltam em `copy.fontes` e aparecem na tela.
3. **Edição e aprovação em lote**: `PUT .../copy/:versaoId` edita o texto à mão; `POST .../copy/aprovar` recebe a lista de versões. Dá para voltar depois e acrescentar um ângulo — quem já tem imagem não gera de novo.
4. **Imagens** (`N8N_WEBHOOK_CRIATIVO_IMAGEM`, uma chamada por copy aprovada, cada uma com seu `versao_id`): a direção de imagem da copy é a instrução principal do prompt; gpt-image devolve 2 opções por copy no callback `POST .../imagens/concluir`. `POST .../imagens/refazer` refaz só uma versão, com comentário; `POST .../imagens/:arquivoId/escolher` fixa a imagem daquela copy.
5. **Artes** (`POST .../artes`): monta uma peça por copy aprovada × formato pedido, num dos três layouts — `sobreposto` (texto sobre a foto com véu), `faixa` (foto em cima, faixa colorida com o texto embaixo) e `cartao` (cartão claro sobre a foto). Feed 1080×1080 e stories 1080×1920 em template HTML (Chromium, um único navegador para o lote). PNGs em `GET /api/arquivos/:id/:token?download=1`.

O texto nunca é gerado dentro da imagem: o gerador de imagem escreve errado. Quem desenha o texto é o motor de peça, onde ele renderiza perfeito. Fotos, imagens, artes e o logo do cliente ficam na tabela `arquivos` (Postgres) porque o volume do Railway não persiste.

### Motor de peça: catálogo de blocos, não modelo por caso

`servicos/peca.js` não tem um layout por tipo de cliente — tem um **catálogo de blocos** que se encaixam em qualquer ordem, e a IA monta a composição do caso:

`marca` (logo) · `titulo` (2 linhas, a 2ª na cor de destaque) · `subtitulo` · `texto` (com `**destaque**`) · `imagem` (hero, faixa, inset, fundo) · `grade` (2 a 8 itens com ícone ou foto + rótulo) · `comparativo` (2 colunas) · `selo` (condição ou preço) · `lista_check` · `cta` · `rodape` (WhatsApp, cidade, preço) · `linha` (dois blocos lado a lado)

As três peças de referência da casa são a mesma coisa remontada: serviços = marca + título + subtítulo + grade + rodapé; comparativo = título-pergunta + imagem + comparativo + lista de check + rodapé; vitrine = título + hero + selo + grade + rodapé de preço.

Dois detalhes que fazem qualquer combinação funcionar sem calibrar peça por peça:

- **Auto-ajuste**: depois de renderizar, o motor procura por busca binária a escala de tipografia (0,5 a 1,3) em que o conteúdo caiba — conferindo altura **e largura** (sem a largura, título grande passava por cima do bloco vizinho). Peça com poucos blocos cresce; peça densa diminui.
- **Ícones da casa** (22 em SVG de traço, herdando a cor da marca): a grade de serviços usa ícone, não 8 imagens de IA — consistente e sem custo por peça.

A composição é validada no n8n antes de voltar: bloco fora do catálogo é descartado, texto que passa do limite é cortado, no máximo uma imagem por peça, rodapé sempre por último, e título e marca são inseridos se a IA esquecer. Assim a peça nunca quebra na frente da pessoa.

A identidade vem da ficha do cliente: `logo` (upload em `POST /api/clientes/:id/logo`), `cor_primaria`, `cor_destaque`, `telefone` e `cidade`. Sem eles a peça sai na paleta da Feeling, sem logo e sem rodapé de contato.

## Prospecção (diagnóstico de presença digital)

Aba "Prospecção": negócio que ainda não é cliente. `POST /api/prospects` → **Localizar** (`POST /prospects/:id/localizar`, webhook `N8N_WEBHOOK_PROSPECT_LOCALIZAR`, síncrono, ~60 s; **cidade é obrigatória** — sem ela a busca traz empresa de mesmo nome de outro estado e não há como separar; a pessoa confirma ou marca "não tem", e a ausência é diagnóstico) → **Coletar** (`POST /prospects/:id/coletar`, `N8N_WEBHOOK_PROSPECT_COLETAR`, assíncrono com callback `.../coletar/concluir`: Apify Google Maps (ficha: nota, avaliações com datas e respostas do dono, fotos, completude, reivindicada, posts do dono; busca "setor + cidade" para posição e concorrentes), Apify Instagram (seguidores, últimos posts, tipo, engajamento, bio), PageSpeed + download do site; nó "Pontuar" com regras fixas → `prospects.diagnostico`) → **Scorecard** na tela → **Diagnóstico em PDF** (`POST /prospects/:id/documento`, `N8N_WEBHOOK_PROSPECT_DIAGNOSTICO`, Claude escreve; conclui pelo callback dos documentos, `documentos_gerados.prospect_id`) → **Virar cliente** (`POST /prospects/:id/virar-cliente`). Os nós do Apify usam a credencial Header Auth "Apify" (`Authorization: Bearer <token>`), selecionada no n8n.

### Como a localização acha o negócio certo

Busca por nome não identifica empresa: `@satransportes_`, `@satransportes`, `@sa.transportes`, `@sa_transportes` e `@s.a_transportes__` existem todos, e qualquer métrica de texto empata. O fluxo trabalha por **cadeia de evidência**:

1. **Ficha no Google pelo Apify** (`compass~crawler-google-places`), não pelo `place_search` do Brave — o índice do Brave não tem empresa pequena brasileira (para "SA Transportes Oliveira MG" devolvia Cascavel-PR, Juiz de Fora e até Michigan, enquanto o Apify achou a ficha certa com a mesma busca). A escolha exige **todas as palavras distintivas** do nome (uma lista de genéricas — transportes, serviços, comércio, brasil… — nunca sustenta a escolha sozinha, que era como "Saga Transportes" ganhava nota máxima) e compara a cidade **no campo cidade**, não no endereço inteiro (rua com nome de cidade passava).
2. **O site que está na ficha é lido**, e dele saem Instagram, WhatsApp e telefone. O telefone do site é conferido contra o da ficha.
3. **Palpites de @ verificados direto no Instagram** (`apify~instagram-profile-scraper`, uma chamada para até 6 palpites: nome colado, sem a palavra final genérica, com pontos, com underscore, mais o que veio do site e o que a pessoa informou). Isso existe porque índice de busca não acha perfil pequeno: `@strikenutritionbrasil` é real e nenhum mecanismo o indexa — o palpite "nome colado" achou, com bio, seguidores e o site na bio.
4. **Conferência** (Claude Haiku) recebe ficha, site, perfis verificados e candidatos da busca e decide qual é — ou diz que não achou, o que é resposta boa. "Alta" só sai com evidência dura: linkado no site oficial, telefone conferindo, bio citando a cidade, ou informado no cadastro.

O cockpit **só confirma sozinho com "alta"**. A tela mostra o motivo de cada candidato ("linkado no site oficial da ficha", "cidade confere", "apareceu na busca por nome — sem evidência"), esconde os sem evidência atrás de "ver todos" e lista o que foi descartado e por quê.

### Os 7 pilares (padrão do documento da casa)

O diagnóstico segue os pesos do PDF "Diagnóstico de Presença e Performance Digital": **Google e SEO local 20% · Instagram 20% · Reputação 15% · Conteúdo 15% · Site 15% · Conversão e jornada 10% · Concorrência 5%**. Cada pilar sai com nota 0–100 (o documento também mostra a rubrica 0–5) e o conjunto vira a nota geral ponderada, mais o **Potencial de oportunidade** (ativos que a empresa já tem × lacunas de aquisição e conversão: quem tem reputação ou audiência e não tem aquisição é ganho rápido).

O que a coleta faz de diferente: um nó de IA (`Definir Buscas`, Haiku) deriva **5 buscas comerciais** do setor e do produto, sempre com a cidade e nunca com o nome da empresa, e todas rodam em uma chamada só do Apify (`searchStringsArray`) — daí sai a tabela "quem aparece quando o cliente procura", com a posição do negócio em cada busca e os concorrentes à frente. O pilar do Google responde o que a casa pede da ficha: existe, é reivindicada, está completa campo a campo, tem fotos, tem atributos (pagamento, acessibilidade, serviços) e **quando o dono publicou por último** (`ownerUpdates`). A reputação usa as 40 avaliações mais recentes: distribuição de 5 a 1 estrela, ritmo em 30/90 dias, palavras recorrentes (`reviewsTags`), percentual respondido, resposta a negativas e respostas genéricas do tipo "obrigado". O site entrega Core Web Vitals, estrutura de páginas lida dos links da home e os pontos de contato (WhatsApp com ou sem mensagem pré-preenchida, telefone clicável, formulário, CTA, pixel do Meta). A jornada é medida em 6 etapas — descoberta, interesse, confiança, consideração, conversão e atendimento (esta última não é avaliada, e o documento diz isso).

Cada problema sai como um **achado** com pilar, impacto, gravidade e facilidade (1–5), que ordenam os gargalos e o plano 30/60/90. O documento traz a matriz **problema → impacto → oportunidade → o que a Feeling faz**, restrita aos serviços da casa, e marca cada afirmação como FATO, OBSERVAÇÃO, INFERÊNCIA ou RECOMENDAÇÃO. O PDF de referência **não** é lido do cérebro na hora de escrever: ele é um diagnóstico preenchido de outro negócio e contaminaria os números — a estrutura está no prompt.

## Padrão da casa no cérebro (tipo `referencia`)

Documentos de método da Feeling (não de um cliente) entram no cérebro com `metadata.tipo = 'referencia'` e `cliente_id = 0`. Hoje estão indexados os três do modelo de atendimento: critérios de análise, modelo de auditoria e sugestões de melhoria. Os fluxos que precisam do método consultam por `tipo = referencia` (sem filtro de cliente) — é o caso da auditoria de atendimento.

## Auditoria de Atendimento (WhatsApp)

A classificação das conversas (workflow "Comercial — Classificar Conversas") avalia, além de etapa/interesse/nota, os **critérios do modelo de auditoria da casa** e grava em `leads_comercial.criterios` (16 marcações booleanas agrupadas em qualidade, script, qualificação, dúvidas, follow-up, gatilhos, personalização, ruídos) e `leads_comercial.falhas` (até 3 frases por conversa). A aba Comercial mostra o bloco "Auditoria do atendimento (padrão Feeling)" com o percentual por critério e as falhas mais repetidas. O botão **"Gerar auditoria (PDF)"** (`POST /api/clientes/:id/comercial/auditoria`, webhook `N8N_WEBHOOK_COMERCIAL_AUDITORIA`) manda os agregados + amostras anonimizadas para o n8n, que lê o padrão da casa no cérebro e escreve o documento nas 10 seções do modelo, terminando em Conclusão e Recomendações (tipo `auditoria`).
