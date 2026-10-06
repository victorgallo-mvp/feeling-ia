// src/rotas/mcp.js
// Conexão MCP: deixa o Claude da equipe consultar o cockpit direto, por conversa, em vez de pela tela.
// SÓ LEITURA — nenhuma ferramenta escreve no banco nem dispara n8n (nada aqui custa dinheiro por chamada).
//
// Três regras que valem para toda ferramenta daqui:
//  1. Ausência não é zero. Campo não medido volta null com a palavra "não medido". Se devolver 0, o modelo
//     relata "custo por lead de R$ 0,00" com toda a confiança — e alguém leva isso para uma reunião.
//  2. Procedência em tudo. Todo número volta com de onde veio e de quando.
//  3. Teto em toda consulta. Lista sem limite enche a janela de contexto e mata a conversa na terceira pergunta.
//
// A lógica continua no n8n e as consultas continuam sendo as mesmas do resto do backend: isto é fachada.
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { pool } = require('../servicos/db');

const router = express.Router();

const TETO_DOCUMENTOS = 40;
const TETO_TEXTO = 40000; // ~10 mil palavras: relatório inteiro cabe, dump acidental não

const texto = (s) => ({ content: [{ type: 'text', text: s }] });
const fmt = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : 'sem data');

// Senha única da equipe, no Railway. Sem ela a rota não sobe: melhor não existir do que existir aberta.
function autorizado(req) {
  const esperado = process.env.MCP_TOKEN || '';
  if (!esperado) return false;
  const veio = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (veio.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(veio), Buffer.from(esperado));
}

// O modelo vai dizer "Agronova", não "cliente 12". Resolver o nome aqui economiza uma chamada em toda
// pergunta. São ~30 clientes: comparar em JavaScript sai mais barato que depender da extensão unaccent
// no Postgres, e acerta acento ("alemao" encontra "Alemão Performance").
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

async function acharCliente(termo) {
  const t = String(termo || '').trim();
  if (!t) throw new Error('diga de qual cliente — nome ou id');
  if (/^\d+$/.test(t)) {
    const { rows } = await pool.query('SELECT id, nome, setor, cidade FROM clientes WHERE id = $1', [Number(t)]);
    if (!rows.length) throw new Error(`não existe cliente com id ${t}`);
    return rows[0];
  }
  const { rows } = await pool.query('SELECT id, nome, setor, cidade FROM clientes');
  const alvo = semAcento(t);
  const exato = rows.find((r) => semAcento(r.nome) === alvo);
  if (exato) return exato;
  const parciais = rows.filter((r) => semAcento(r.nome).includes(alvo)).sort((a, b) => a.nome.length - b.nome.length);
  if (!parciais.length) throw new Error(`nenhum cliente com "${t}" no nome — use listar_clientes para ver os nomes exatos`);
  if (parciais.length > 1) {
    throw new Error(`"${t}" casa com mais de um cliente: ${parciais.map((r) => `${r.nome} (id ${r.id})`).join(', ')}. Repita com o nome exato ou o id.`);
  }
  return parciais[0];
}

function montarServidor() {
  const s = new McpServer({ name: 'cockpit-feeling', version: '1.0.0' });

  s.registerTool('listar_clientes', {
    title: 'Listar clientes',
    description:
      'Todos os clientes da agência com o que existe de dado para cada um. Use PRIMEIRO, quando não souber o nome exato de um cliente ou quiser saber sobre quem dá para perguntar. ' +
      'As colunas "documentos" e "anexos" dizem quanto material existe — cliente com 0 documentos ainda não teve nada gerado, o que é diferente de ter ido mal.',
    inputSchema: {},
  }, async () => {
    const { rows } = await pool.query(`
      SELECT c.id, c.nome, c.setor, c.cidade, c.conta_id,
             COALESCE(c.whatsapp_ativo, false) AS whatsapp,
             (SELECT count(*)::int FROM documentos_gerados d WHERE d.cliente_id = c.id AND d.estado = 'ok') AS documentos,
             (SELECT count(DISTINCT metadata->>'titulo')::int FROM cerebro WHERE metadata->>'cliente_id' = c.id::text) AS anexos
        FROM clientes c ORDER BY c.nome`);
    if (!rows.length) return texto('Nenhum cliente cadastrado.');
    const linhas = rows.map((c) =>
      `${c.id}\t${c.nome}\t${c.setor || '—'}\t${c.cidade || 'cidade não informada'}\t${c.documentos} doc\t${c.anexos} anexos\t${c.whatsapp ? 'WhatsApp ligado' : 'sem WhatsApp'}`);
    return texto(
      `${rows.length} clientes (id, nome, setor, cidade, documentos, anexos, comercial):\n\n${linhas.join('\n')}\n\n` +
      `Para ler algo de um deles, use documentos_do_cliente com o nome.`
    );
  });

  s.registerTool('documentos_do_cliente', {
    title: 'Documentos de um cliente',
    description:
      'Lista os documentos já gerados para um cliente: relatório semanal, briefing, pesquisa de mercado, análise de presença digital, auditoria de atendimento, resumo de reunião. ' +
      'Devolve id, tipo e data — não o conteúdo. Para ler o texto, use ler_documento com o id que sair daqui.',
    inputSchema: {
      cliente: z.string().describe('Nome do cliente (parcial serve: "agronova") ou o id numérico.'),
      tipo: z.string().optional().describe('Opcional, para filtrar: relatorio_semanal, briefing, pesquisa, analise, reuniao, auditoria, diagnostico.'),
    },
  }, async ({ cliente, tipo }) => {
    const c = await acharCliente(cliente);
    const params = [c.id];
    let filtro = '';
    if (tipo && String(tipo).trim()) { params.push(`%${String(tipo).trim()}%`); filtro = ' AND tipo ILIKE $2'; }
    params.push(TETO_DOCUMENTOS);
    const { rows } = await pool.query(
      `SELECT id, tipo, criado_em, estado, (markdown IS NOT NULL) AS tem_texto
         FROM documentos_gerados WHERE cliente_id = $1${filtro}
        ORDER BY criado_em DESC LIMIT $${params.length}`, params);
    if (!rows.length) {
      return texto(`${c.nome} não tem documento${tipo ? ` do tipo "${tipo}"` : ''} gerado ainda.\n` +
        `Isso significa que ninguém gerou — não que o resultado foi ruim.`);
    }
    const linhas = rows.map((d) => {
      const sem = d.estado !== 'ok' ? ` [${d.estado}]` : (d.tem_texto ? '' : ' [PDF existe, texto não está no banco]');
      return `${d.id}\t${d.tipo}\t${fmt(d.criado_em)}${sem}`;
    });
    return texto(`${rows.length} documentos de ${c.nome} (id, tipo, data):\n\n${linhas.join('\n')}` +
      (rows.length === TETO_DOCUMENTOS ? `\n\n(mostrando os ${TETO_DOCUMENTOS} mais recentes)` : ''));
  });

  s.registerTool('ler_documento', {
    title: 'Ler um documento',
    description:
      'Devolve o texto completo de um documento pelo id (o id vem de documentos_do_cliente). ' +
      'É o conteúdo escrito pela agência para o cliente: use como fonte, citando de qual documento e de que data veio.',
    inputSchema: { id: z.number().int().describe('Id do documento, vindo de documentos_do_cliente.') },
  }, async ({ id }) => {
    const { rows } = await pool.query(
      'SELECT id, cliente_nome, tipo, criado_em, estado, markdown FROM documentos_gerados WHERE id = $1', [id]);
    if (!rows.length) return texto(`Não existe documento com id ${id}.`);
    const d = rows[0];
    if (!d.markdown) {
      return texto(`O documento ${d.id} (${d.tipo} de ${d.cliente_nome}, ${fmt(d.criado_em)}) não tem o texto no banco` +
        `${d.estado !== 'ok' ? ` — estado "${d.estado}"` : ' — só o PDF foi guardado'}. Não dá para ler por aqui.`);
    }
    const corpo = d.markdown.length > TETO_TEXTO
      ? `${d.markdown.slice(0, TETO_TEXTO)}\n\n[...cortado: o documento tem ${d.markdown.length} caracteres]`
      : d.markdown;
    return texto(`FONTE: ${d.tipo} de ${d.cliente_nome}, gerado em ${fmt(d.criado_em)} (documento ${d.id}).\n\n${corpo}`);
  });

  return s;
}

// Sem sessão: cada pedido monta servidor e transporte, responde e fecha. Menos peça móvel para quebrar.
router.post('/mcp', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ erro: 'senha do MCP ausente ou inválida' });
  const servidor = montarServidor();
  const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transporte.close(); servidor.close(); });
  try {
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp]', e);
    if (!res.headersSent) res.status(500).json({ erro: e.message });
  }
});

// O cliente MCP tenta abrir um canal de eventos; sem sessão não há o que manter aberto.
router.get('/mcp', (req, res) => res.status(405).json({ erro: 'use POST' }));
router.delete('/mcp', (req, res) => res.status(405).json({ erro: 'use POST' }));

module.exports = router;
