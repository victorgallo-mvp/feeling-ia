// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { migrar } = require('./servicos/db');

const app = express();

const origens = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: origens.length ? origens : true }));
app.use(express.json({ limit: '25mb' })); // o callback de criativos traz imagens em base64

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', require('./rotas/clientes'));
app.use('/api', require('./rotas/gerar'));
app.use('/api', require('./rotas/documentos'));
app.use('/api', require('./rotas/anexar'));
app.use('/api', require('./rotas/reunioes'));
const comercial = require('./rotas/comercial');
app.use('/api', comercial);
app.use('/api', require('./rotas/criativos'));
app.use('/api', require('./rotas/prospeccao'));

app.use((req, res) => res.status(404).json({ erro: 'rota não encontrada' }));

// Corpo JSON malformado ou grande demais (erros do express.json) — responde no formato da API.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'conteúdo grande demais' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  console.error(err);
  res.status(500).json({ erro: 'erro interno' });
});

const PORT = process.env.PORT || 3000;

migrar()
  .catch((e) => console.error('[db] migração falhou:', e.message))
  .finally(() => {
    const server = app.listen(PORT, () => console.log(`Cockpit Feeling backend na porta ${PORT}`));
    comercial.agendarRodadaDiaria();
    // A geração espera o n8n por até 120s — o servidor não pode cortar antes.
    server.requestTimeout = 180000;
  });
