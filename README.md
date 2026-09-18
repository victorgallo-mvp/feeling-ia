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

## Onde cada informação do cliente mora

| Informação | Onde | Quem lê |
|---|---|---|
| nome, setor, cidade, `conta_id` | colunas de `clientes` | n8n por SQL (valor exato) |
| `instagram` (handle sem @), `site` (com https://), `google_ads_id` (123-456-7890) | colunas de `clientes` | vão no corpo de todo webhook de geração |
| perfil (público, diferenciais, ticket…) | `clientes.perfil` (texto, editar substitui) | n8n injeta direto no prompt de pesquisa/briefing |
| orientações para a IA (foco do momento, o que evitar, tom) | `clientes.orientacoes` (até 1.500 caracteres) | bloco fixo "Orientações da equipe" nos 4 workflows — nunca vai pro cérebro |
| documentos longos (PDF/DOCX/TXT) | tabela `cerebro` via upload (metadata `cliente_id`, `titulo`, `tipo` — o webhook aceita `tipo`, padrão `anexo`) | n8n por busca semântica filtrada por `cliente_id` |

Todo webhook de geração recebe `cliente_id`; os workflows do n8n resolvem o cliente por ele (fallback: nome). O cérebro é filtrado por `metadata.cliente_id`.

`conta_id` tem que ser idêntico ao do Sentinel (`metricas_serie_temporal.conta_id`): valor errado não dá erro, o relatório só sai sem números.

## Contrato dos webhooks de geração

`POST` com JSON; o workflow responde `{ "markdown": "..." }` em até 120s.

```json
{ "conta_id": "alemao-performance", "cliente_nome": "Alemão Performance", "cliente_id": 1,
  "instagram": "alemaoperformance", "site": "https://alemaoperformance.com.br", "google_ads_id": null }
```

Campos não preenchidos chegam como `null`. `GET /api/tipos` diz quais documentos têm webhook configurado.
