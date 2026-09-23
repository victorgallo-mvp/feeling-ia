// src/rotas/prospeccao.js
// Prospecção: diagnóstico de presença digital de quem ainda não é cliente.
// Localizar (n8n, síncrono: candidatos de ficha do Google, Instagram e site) -> a pessoa confirma ->
// Coletar (n8n, assíncrono com callback: Apify Maps/Instagram, PageSpeed, rastreio) -> scorecard ->
// Diagnóstico em PDF (n8n escreve; mesmo callback dos documentos) -> Virar cliente.
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { pool } = require('../servicos/db');

const CAMPOS = 'id, nome, cidade, setor, site, instagram, gmn, candidatos, estado, diagnostico, erro, cliente_id, criado_em, atualizado_em';
const TEMPO_MAXIMO_MIN = 12;
const texto = (v, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

function urlPublica(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}
async function buscar(id) {
  const { rows } = await pool.query(`SELECT ${CAMPOS}, callback_token FROM prospects WHERE id = $1`, [id]);
  return rows[0] || null;
}
async function atualizar(id, patch) {
  const chaves = Object.keys(patch);
  const sets = chaves.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const valores = chaves.map((k) => (patch[k] !== null && typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]));
  await pool.query(`UPDATE prospects SET ${sets}, atualizado_em = now() WHERE id = $1`, [id, ...valores]);
}
const publico = (p) => (p ? { ...p, callback_token: undefined } : p);
const normalizarHandle = (v) => (v ? String(v).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0].trim() || null : null);
const normalizarSite = (v) => { if (!v) return null; const u = /^https?:\/\//i.test(v) ? v.trim() : `https://${v.trim()}`; try { return new URL(u).hostname.includes('.') ? u : null; } catch { return null; } };

router.get('/prospects', async (req, res) => {
  try {
    await pool.query(`UPDATE prospects SET estado = 'erro', erro = 'o n8n não respondeu em ${TEMPO_MAXIMO_MIN} minutos'
      WHERE estado IN ('coletando') AND atualizado_em < now() - interval '${TEMPO_MAXIMO_MIN} minutes'`);
    const { rows } = await pool.query(`SELECT ${CAMPOS} FROM prospects ORDER BY atualizado_em DESC LIMIT 200`);
    res.json(rows.map((p) => ({
      ...p,
      diagnostico: p.diagnostico ? { notas: p.diagnostico.notas, potencial: p.diagnostico.potencial ? { nivel: p.diagnostico.potencial.nivel } : null } : null,
      candidatos: undefined,
    })));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/prospects', async (req, res) => {
  const b = req.body || {};
  const nome = texto(b.nome, 120);
  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO prospects (nome, cidade, setor, site, instagram) VALUES ($1,$2,$3,$4,$5) RETURNING ${CAMPOS}`,
      [nome, texto(b.cidade, 120), texto(b.setor, 120), normalizarSite(b.site), normalizarHandle(b.instagram)]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/prospects/:id', async (req, res) => {
  try {
    const p = await buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'prospect não encontrado' });
    const { rows: docs } = await pool.query(
      `SELECT id, tipo, criado_em, estado, erro FROM documentos_gerados WHERE prospect_id = $1 ORDER BY id DESC`, [p.id]);
    res.json({ ...publico(p), documentos: docs.map((d) => ({ ...d, url_download: `/api/documentos/${d.id}/download` })) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.put('/prospects/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const p = await buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'prospect não encontrado' });
    await atualizar(p.id, {
      nome: texto(b.nome, 120) || p.nome, cidade: texto(b.cidade, 120), setor: texto(b.setor, 120),
      site: normalizarSite(b.site), instagram: normalizarHandle(b.instagram),
      gmn: b.gmn && typeof b.gmn === 'object' ? b.gmn : null,
    });
    res.json(publico(await buscar(p.id)));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.delete('/prospects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM documentos_gerados WHERE prospect_id = $1', [req.params.id]);
    const r = await pool.query('DELETE FROM prospects WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ erro: 'prospect não encontrado' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Localizar: o n8n procura a ficha do Google, o @ e o site pelo nome + cidade e devolve candidatos (síncrono, ~30-60 s).
router.post('/prospects/:id/localizar', async (req, res) => {
  const url = process.env.N8N_WEBHOOK_PROSPECT_LOCALIZAR;
  if (!url) return res.status(503).json({ erro: 'N8N_WEBHOOK_PROSPECT_LOCALIZAR não configurado' });
  try {
    const p = await buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'prospect não encontrado' });
    await atualizar(p.id, { estado: 'localizando', erro: null });
    const resp = await axios.post(url, { prospect_id: p.id, nome: p.nome, cidade: p.cidade, setor: p.setor, site: p.site, instagram: p.instagram },
      { timeout: 170000, headers: { 'Content-Type': 'application/json' } });
    const d = resp.data || {};
    if (d.erro) throw new Error(d.erro);
    const candidatos = { gmn: d.gmn || [], instagram: d.instagram || [], sites: d.sites || [] };
    // O que a pessoa já informou no cadastro vira a primeira opção, com confiança total — não faz sentido pedir para escolher de novo.
    const limpar = (v) => String(v || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const comInformado = (lista, campo, valor, extra) => {
      if (!valor) return lista;
      const achado = lista.find((x) => limpar(x[campo]) === limpar(valor));
      if (achado) { achado.confianca = 1; achado.informado = true; return [achado, ...lista.filter((x) => x !== achado)]; }
      return [{ [campo]: valor, confianca: 1, informado: true, ...extra }, ...lista];
    };
    candidatos.instagram = comInformado(candidatos.instagram, 'username', p.instagram, { url: `https://www.instagram.com/${p.instagram}/` });
    candidatos.sites = comInformado(candidatos.sites, 'url', p.site, {});
    // Confirmação automática quando o primeiro candidato é claro (≥ 0,8, ou ≥ 0,6 com folga sobre o segundo); a pessoa revisa na tela.
    const claro = (lista) => lista.length && (lista[0].confianca >= 0.8 || (lista[0].confianca >= 0.6 && (lista.length === 1 || lista[0].confianca - lista[1].confianca >= 0.25)));
    const patch = { candidatos, estado: 'localizado' };
    if (!p.gmn && claro(candidatos.gmn)) patch.gmn = candidatos.gmn[0];
    if (!p.instagram && claro(candidatos.instagram)) patch.instagram = candidatos.instagram[0].username;
    if (!p.site && claro(candidatos.sites)) patch.site = candidatos.sites[0].url;
    await atualizar(p.id, patch);
    res.json(publico(await buscar(p.id)));
  } catch (e) {
    await atualizar(req.params.id, { estado: 'erro', erro: `localizar: ${e.message}` }).catch(() => {});
    res.status(502).json({ erro: e.message });
  }
});

// Confirmar/ajustar o que foi localizado. { gmn: {...}|null, instagram: '@'|null, site: 'url'|null, sem_gmn/sem_instagram/sem_site: true }
router.post('/prospects/:id/confirmar', async (req, res) => {
  const b = req.body || {};
  try {
    const p = await buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'prospect não encontrado' });
    await atualizar(p.id, {
      gmn: b.sem_gmn ? { inexistente: true } : (b.gmn && typeof b.gmn === 'object' ? b.gmn : p.gmn),
      instagram: b.sem_instagram ? null : (normalizarHandle(b.instagram) ?? p.instagram),
      site: b.sem_site ? null : (normalizarSite(b.site) ?? p.site),
      estado: 'localizado', erro: null,
    });
    res.json(publico(await buscar(p.id)));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Coletar: n8n coleta tudo e chama o callback com o diagnóstico (assíncrono).
router.post('/prospects/:id/coletar', async (req, res) => {
  const url = process.env.N8N_WEBHOOK_PROSPECT_COLETAR;
  if (!url) return res.status(503).json({ erro: 'N8N_WEBHOOK_PROSPECT_COLETAR não configurado' });
  try {
    const p = await buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'prospect não encontrado' });
    const token = crypto.randomBytes(16).toString('hex');
    await atualizar(p.id, { estado: 'coletando', erro: null, callback_token: token });
    const resp = await axios.post(url, {
      prospect_id: p.id, nome: p.nome, cidade: p.cidade, setor: p.setor, site: p.site, instagram: p.instagram,
      gmn: p.gmn && !p.gmn.inexistente ? p.gmn : null,
      callback_url: `${urlPublica(req)}/api/prospects/${p.id}/coletar/concluir`, callback_token: token,
    }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
    if (!resp.data?.aceito) throw new Error('o n8n não aceitou o pedido');
    res.status(202).json(publico(await buscar(p.id)));
  } catch (e) {
    await atualizar(req.params.id, { estado: 'erro', erro: `coletar: ${e.message}` }).catch(() => {});
    res.status(502).json({ erro: e.message });
  }
});

// Callback da coleta: { diagnostico: {...}, erro }.
router.post('/prospects/:id/coletar/concluir', async (req, res) => {
  try {
    const p = await buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'prospect não encontrado' });
    const token = req.get('x-cockpit-token') || req.body?.callback_token;
    if (!p.callback_token || token !== p.callback_token) return res.status(403).json({ erro: 'token inválido' });
    const b = req.body || {};
    if (!b.diagnostico || typeof b.diagnostico !== 'object') {
      await atualizar(p.id, { estado: 'erro', erro: String(b.erro || 'o n8n terminou sem diagnóstico').slice(0, 500), callback_token: null });
      return res.json({ ok: true });
    }
    await atualizar(p.id, { diagnostico: { ...b.diagnostico, coletado_em: new Date().toISOString() }, estado: 'pronto', erro: null, callback_token: null });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ erro: e.message }); }
});

// Documento "Diagnóstico de Presença Digital" (PDF): n8n escreve a partir do diagnóstico; conclui pelo callback dos documentos.
router.post('/prospects/:id/documento', async (req, res) => {
  const url = process.env.N8N_WEBHOOK_PROSPECT_DIAGNOSTICO;
  if (!url) return res.status(503).json({ erro: 'N8N_WEBHOOK_PROSPECT_DIAGNOSTICO não configurado' });
  try {
    const p = await buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'prospect não encontrado' });
    if (!p.diagnostico) return res.status(409).json({ erro: 'colete os dados antes de gerar o diagnóstico' });
    const token = crypto.randomBytes(24).toString('hex');
    const ins = await pool.query(
      `INSERT INTO documentos_gerados (cliente_id, cliente_nome, prospect_id, tipo, estado, extras)
       VALUES (NULL, $1, $2, 'diagnostico', 'gerando', $3) RETURNING id, tipo, criado_em, estado`,
      [p.nome, p.id, JSON.stringify({ callback_token: token })]
    );
    const doc = ins.rows[0];
    axios.post(url, {
      prospect_id: p.id, documento_id: doc.id, nome: p.nome, cidade: p.cidade, setor: p.setor, site: p.site, instagram: p.instagram, gmn: p.gmn,
      diagnostico: p.diagnostico,
      callback_url: `${urlPublica(req)}/api/documentos/${doc.id}/concluir`, callback_token: token,
    }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } })
      .catch(async (e) => { await pool.query("UPDATE documentos_gerados SET estado = 'erro', erro = $2 WHERE id = $1", [doc.id, e.message]).catch(() => {}); });
    res.status(202).json({ ...doc, url_download: `/api/documentos/${doc.id}/download` });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Virar cliente: cria o cadastro já preenchido e liga o prospect a ele.
router.post('/prospects/:id/virar-cliente', async (req, res) => {
  try {
    const p = await buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'prospect não encontrado' });
    if (p.cliente_id) return res.status(409).json({ erro: 'este prospect já virou cliente', cliente_id: p.cliente_id });
    const d = p.diagnostico || {};
    const rep = d.reputacao || d.gmn || {}; // v2 separa reputação da ficha; v1 guardava tudo em "gmn"
    const hoje = new Date().toLocaleDateString('pt-BR');
    const linhas = [];
    if (p.gmn?.categoria || d.google?.categoria) linhas.push(`Categoria no Google: ${d.google?.categoria || p.gmn.categoria}`);
    if (rep.nota) linhas.push(`Google Meu Negócio: nota ${rep.nota} em ${rep.avaliacoes || 0} avaliações (diagnóstico de ${hoje})`);
    if (d.instagram?.seguidores) linhas.push(`Instagram: ${d.instagram.seguidores} seguidores`);
    if (d.notas?.geral != null) linhas.push(`Diagnóstico de presença digital ${hoje}: nota geral ${d.notas.geral}/100${d.potencial?.nivel ? `, potencial ${d.potencial.nivel}` : ''}`);
    if (d.gargalos?.length) linhas.push(`Gargalos na entrada: ${d.gargalos.slice(0, 3).join('; ')}`);
    const { rows } = await pool.query(
      `INSERT INTO clientes (nome, setor, cidade, site, instagram, perfil) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome`,
      [p.nome, p.setor, p.cidade, p.site, p.instagram, linhas.join('\n') || null]
    );
    await atualizar(p.id, { cliente_id: rows[0].id });
    await pool.query('UPDATE documentos_gerados SET cliente_id = $1 WHERE prospect_id = $2', [rows[0].id, p.id]);
    res.status(201).json({ cliente: rows[0] });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
