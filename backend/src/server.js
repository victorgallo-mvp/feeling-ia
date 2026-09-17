// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { migrar } = require('./servicos/db');

const app = express();

const origens = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: origens.length ? origens : true }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', require('./rotas/clientes'));
app.use('/api', require('./rotas/gerar'));
app.use('/api', require('./rotas/documentos'));
app.use('/api', require('./rotas/anexar'));

app.use((req, res) => res.status(404).json({ erro: 'rota não encontrada' }));

const PORT = process.env.PORT || 3000;

migrar()
  .catch((e) => console.error('[db] migração falhou:', e.message))
  .finally(() => {
    const server = app.listen(PORT, () => console.log(`Cockpit Feeling backend na porta ${PORT}`));
    // A geração espera o n8n por até 120s — o servidor não pode cortar antes.
    server.requestTimeout = 180000;
  });
