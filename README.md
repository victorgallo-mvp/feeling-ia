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
- [x] Deploy — Railway (backend) + Vercel (frontend)

## Onde cada informação do cliente mora

| Informação | Onde | Quem lê |
|---|---|---|
| nome, setor, cidade, `conta_id` | colunas de `clientes` | n8n por SQL (valor exato) |
| perfil (público, diferenciais, ticket…) | `clientes.perfil` (texto, editar substitui) | n8n injeta direto no prompt de pesquisa/briefing |
| documentos longos (PDF/DOCX/TXT) | tabela `cerebro` via upload | n8n por busca semântica (RAG) |

`conta_id` tem que ser idêntico ao do Sentinel (`metricas_serie_temporal.conta_id`): valor errado não dá erro, o relatório só sai sem números.
