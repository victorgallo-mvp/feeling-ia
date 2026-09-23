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

Seção "Criativos" na página do cliente. Fluxo com aprovação humana entre etapas: contexto (objetivo, produto, oferta, público, formato, direção visual, fotos do produto) → `POST /api/clientes/:id/criativos` grava o criativo e dispara `N8N_WEBHOOK_CRIATIVO_IMAGEM` (workflow "Criativo — Gerar Imagem": descreve as fotos por URL, Claude monta o prompt, gpt-image gera 2 opções, callback `POST /api/criativos/:id/imagens/concluir` com token) → a pessoa aprova uma imagem (`POST .../imagens/:arquivoId/aprovar`) ou pede outras com comentário (`.../imagens/refazer`) → copy síncrona via `N8N_WEBHOOK_CRIATIVO_COPY` (3 variações + legenda; `.../copy/refazer`) → a pessoa escolhe/edita e `POST .../arte` monta feed 1080×1080 e/ou stories 1080×1920 em template HTML (Chromium) → PNGs para download em `GET /api/arquivos/:id/:token?download=1`. Fotos, imagens e artes ficam na tabela `arquivos` (Postgres) porque o volume do Railway não persiste.
