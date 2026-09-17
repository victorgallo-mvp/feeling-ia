# Projeto: Cockpit Feeling (painel de geração de documentos)

## Contexto
Estou construindo o painel interno de uma agência de marketing (Feeling). Faz parte de um ecossistema de IA maior que JÁ EXISTE e funciona. Este projeto é APENAS a fachada (frontend + backend fino). Não reimplemente lógica de IA/dados.

**Arquitetura mãe (já pronta, não mexer):**
- **n8n** (self-hosted, instância própria) = o motor. Já tem workflows funcionando que geram relatório semanal, pesquisa de mercado e briefing, consultando um Postgres com pgvector (o "cérebro") e um segundo Postgres (métricas de anúncios "Sentinel") e o Claude. Toda a lógica pesada vive aqui.
- **Postgres (cérebro)** = tem a tabela `clientes` (id, nome, setor, cidade, conta_id, criado_em) e as tabelas de RAG. É desse banco que o painel lê a lista de clientes.
- Este projeto NÃO fala com Sentinel, cérebro ou Claude diretamente. Ele fala com o **n8n via webhook** e com o Postgres só pra ler `clientes` e gravar `documentos_gerados`.

**Regra de ouro:** lógica de IA/dados → n8n. Cola, PDF, arquivo, tela → este projeto. Se você sentir vontade de puxar métrica ou chamar o Claude aqui, PARE — isso é trabalho do n8n; aqui só chamamos o webhook dele.

## O que construir (MVP)
Um painel web interno, sem login por enquanto (todos veem todos os clientes).

**Fluxo do usuário:** abre a lista de clientes → clica num cliente (ex.: "Alemão") → vê 3 botões (Gerar Relatório, Gerar Pesquisa de Mercado, Gerar Briefing) + uma área de upload ("anexar documento pra alimentar a IA") + a lista de PDFs já gerados desse cliente (com download). Clicar num botão gera o documento (chama o n8n), converte em PDF e disponibiliza pra download. Geração direta, sem passo de revisão (é MVP).

## Stack
- **Backend:** Node + Express. Deploy no Railway (mesmo projeto do Postgres). PDF via Puppeteer.
- **Frontend:** React + Vite. Deploy na Vercel. Fala SÓ com o backend (nunca direto com n8n/DB).
- **DB:** Postgres já existente (uso a mesma `DATABASE_URL` do cérebro). Criar só a tabela nova `documentos_gerados`.

## Estrutura de pastas
```
/backend
  package.json
  src/
    server.js
    rotas/{clientes,gerar,documentos,anexar}.js
    servicos/{n8n,pdf,db,storage}.js
    templates/relatorio.html
/frontend
  package.json
  src/
    api.js
    paginas/{ListaClientes,Cliente}.jsx
    App.jsx  main.jsx
```

## Contrato de API (backend expõe, frontend consome)
- `GET /api/clientes` → `[{id, nome, setor, cidade}]` (lê tabela clientes)
- `GET /api/clientes/:id` → `{id, nome, setor, cidade, conta_id}`
- `POST /api/clientes/:id/gerar/:tipo` (tipo = relatorio | pesquisa | briefing)
    → backend chama o webhook n8n correspondente, recebe `{ markdown }`, gera PDF, salva em storage, insere em `documentos_gerados`, devolve `{id, tipo, url_download, criado_em}`
- `GET /api/clientes/:id/documentos` → lista de `documentos_gerados` do cliente
- `GET /api/documentos/:id/download` → devolve o PDF (application/pdf)
- `POST /api/clientes/:id/anexar` (multipart, campo "arquivo") → repassa o arquivo pro webhook n8n de ingestão; NÃO precisa ficar visível na UI depois. Responde `{ ok: true }`

## Tabela nova (única migração)
```sql
CREATE TABLE IF NOT EXISTS documentos_gerados (
  id SERIAL PRIMARY KEY,
  cliente_id INT,
  cliente_nome TEXT,
  tipo TEXT,                 -- relatorio | pesquisa | briefing
  caminho TEXT,              -- caminho do PDF no storage
  criado_em TIMESTAMP DEFAULT now()
);
```

## Variáveis de ambiente
Backend:
- `DATABASE_URL` (o Postgres do cérebro — já existe)
- `N8N_WEBHOOK_RELATORIO`, `N8N_WEBHOOK_PESQUISA`, `N8N_WEBHOOK_BRIEFING`, `N8N_WEBHOOK_ANEXAR` (URLs que vou te passar depois; deixe configuráveis)
- `STORAGE_DIR` (ex.: `/data/pdfs` num volume do Railway) — default `./pdfs`
- `PORT` (Railway injeta)
Frontend:
- `VITE_API_URL` (URL do backend)

## Detalhe importante do webhook n8n
Ao chamar `POST /api/clientes/:id/gerar/:tipo`, o backend faz um POST no webhook do n8n mandando `{ conta_id, cliente_nome }` e ESPERA a resposta síncrona com o conteúdo do documento em markdown: `{ markdown: "..." }`. (Os workflows do n8n vão ser ajustados pra responder assim — não é problema seu; só implemente o cliente HTTP que faz o POST e lê `response.data.markdown`.) Trate timeout de até 120s (a geração demora).

## PDF
Use o `pdf.js` e o `relatorio.html` que estou fornecendo (Puppeteer). O visual já está no padrão da agência — não invente CSS novo. A função recebe markdown, injeta no template e devolve o Buffer do PDF.

## Ordem de construção (siga assim, não pule)
1. Backend: `GET /api/clientes` + `POST /api/clientes/:id/gerar/relatorio` só (com PDF e download). Deixe os webhooks de pesquisa/briefing/anexar stubados.
2. Frontend: lista → página do cliente → botão "Gerar Relatório" → aparece na lista de documentos → download.
3. Rode fim-a-fim com 1 cliente real e um webhook de teste.
4. Só então: pesquisa, briefing e upload.

Comece pelo passo 1. Antes de escrever, me mostre a estrutura de arquivos que vai criar e confirme o contrato de API.
