// src/rotas/anexar.js
// STUB (passo 1). No passo 4: multer (campo "arquivo") + anexarViaN8n.
const express = require('express');
const router = express.Router();

router.post('/clientes/:id/anexar', (req, res) => {
  res.status(501).json({ erro: 'upload ainda não implementado' });
});

module.exports = router;
