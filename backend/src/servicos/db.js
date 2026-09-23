// src/servicos/db.js
// Conexão com o Postgres do cérebro. Aqui só lemos `clientes` e gravamos `documentos_gerados`.
const { Pool, types } = require('pg');

// `criado_em` é TIMESTAMP sem fuso e o Postgres do Railway grava em UTC. Sem isto o pg
// interpreta o valor no fuso da máquina e a data sai deslocada (3h a mais rodando no Brasil).
types.setTypeParser(types.builtins.TIMESTAMP, (v) => new Date(v.replace(' ', 'T') + 'Z'));

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL não definida — as rotas que usam o banco vão falhar.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Falha de conexão chega como AggregateError com message vazia (uma tentativa por IP);
// sem isto a API responderia { erro: "" }.
const consultar = pool.query.bind(pool);
pool.query = async (...args) => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida no servidor');
  try {
    return await consultar(...args);
  } catch (e) {
    if (!e.message && e.errors?.length) e.message = 'sem conexão com o banco: ' + e.errors.map((x) => x.message).join('; ');
    throw e;
  }
};

// Migrações do projeto (idempotentes, rodam no boot).
async function migrar() {
  // Colunas de `clientes` que o cockpit edita; `perfil` é o contexto livre que o n8n injeta no prompt.
  await pool.query(`
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS conta_id TEXT;
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cidade TEXT;
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS perfil TEXT;
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS instagram TEXT;      -- handle, sem @
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS site TEXT;
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS google_ads_id TEXT;  -- 123-456-7890
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS orientacoes TEXT;    -- instruções da equipe pra IA (curto)
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS abrangencia TEXT;    -- local | regional | nacional (NULL = IA infere)
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS extras JSONB;        -- sugestoes: [{id, origem, criado_em, sugestoes, aplicadas}]; comercial: estado da classificação
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS whatsapp_ativo BOOLEAN; -- aba Comercial ligada
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS whatsapp_webhook TEXT;  -- webhook de classificação próprio (opcional; padrão N8N_WEBHOOK_COMERCIAL)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documentos_gerados (
      id SERIAL PRIMARY KEY,
      cliente_id INT,
      cliente_nome TEXT,
      tipo TEXT,                 -- relatorio | pesquisa | briefing | analise
      caminho TEXT,              -- caminho do PDF no storage
      criado_em TIMESTAMP DEFAULT now()
    );
    -- markdown devolvido pelo n8n: deixa o briefing ler a última pesquisa por SQL
    ALTER TABLE documentos_gerados ADD COLUMN IF NOT EXISTS markdown TEXT;
    -- extras: dados por tipo (reunião: titulo, data_reuniao, transcricao, sugestoes, aplicadas)
    ALTER TABLE documentos_gerados ADD COLUMN IF NOT EXISTS extras JSONB;
    -- geração assíncrona: gerando -> ok | erro (callback do n8n)
    ALTER TABLE documentos_gerados ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'ok';
    ALTER TABLE documentos_gerados ADD COLUMN IF NOT EXISTS erro TEXT;
  `);
  // Acompanhamento comercial: uma linha por lead do WhatsApp do cliente. Métricas vêm do n8n (SQL no banco
  // do WhatsApp); etapa/interesse/nota vêm do Claude, também pelo n8n. O cockpit só lê.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads_comercial (
      cliente_id INT NOT NULL,
      contato TEXT NOT NULL,                 -- telefone (user_id no banco do WhatsApp)
      nome TEXT,
      origem TEXT,                           -- anuncio | organico
      anuncio TEXT,                          -- texto do anúncio (externalAdReply), se veio de anúncio
      primeiro_contato TIMESTAMPTZ,
      ultima_msg TIMESTAMPTZ,
      ultima_msg_de TEXT,                    -- lead | ia | humano
      msgs_lead INT DEFAULT 0,
      msgs_ia INT DEFAULT 0,
      msgs_humano INT DEFAULT 0,
      ia_ativa BOOLEAN,
      primeira_resposta_humana_seg INT,      -- do 1º contato até a 1ª mensagem [DIRETO]
      aguardando_resposta_h INT,             -- horas desde a última msg do lead sem resposta (NULL se respondido)
      perfil JSONB,                          -- profile extraído pela IA do WhatsApp
      etapa TEXT,                            -- novo | em_conversa | qualificado | simulacao_enviada | agendou | comprou | perdido | esfriou
      interesse TEXT,
      operacao TEXT,                         -- a_vista | financiamento | consorcio | nao_definido
      objecao TEXT,
      proximo_passo TEXT,
      resumo TEXT,
      nota_atendimento INT,                  -- 1 a 5 (parte humana do atendimento)
      motivo_nota TEXT,
      msgs_na_classificacao INT,             -- total de msgs quando classificou; muda -> reclassifica
      classificado_em TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (cliente_id, contato)
    );
    CREATE INDEX IF NOT EXISTS leads_comercial_cliente_data ON leads_comercial (cliente_id, primeiro_contato);
    -- auditoria no padrão da casa (10 critérios do "Modelo de Auditoria de Atendimento via WhatsApp")
    ALTER TABLE leads_comercial ADD COLUMN IF NOT EXISTS criterios JSONB;
    ALTER TABLE leads_comercial ADD COLUMN IF NOT EXISTS falhas JSONB;
  `);
  // Criativos: contexto -> imagens (n8n) -> aprovação -> copy (n8n) -> escolha -> arte (cockpit, template HTML).
  // Arquivos (fotos, imagens, artes) ficam no Postgres: o volume do Railway não persiste.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS criativos (
      id SERIAL PRIMARY KEY,
      cliente_id INT NOT NULL,
      titulo TEXT,
      estado TEXT NOT NULL DEFAULT 'imagem_gerando', -- imagem_gerando | imagem_pendente | copy_gerando | copy_pendente | arte_gerando | pronto | erro
      contexto JSONB,                                 -- objetivo, produto, oferta, publico, formato, estilo
      imagens JSONB DEFAULT '[]'::jsonb,              -- [{arquivo_id, prompt, racional, aprovada, rodada}]
      copy JSONB,                                     -- {variacoes:[{headline,texto,cta}], legenda, escolhida:{...}}
      artes JSONB DEFAULT '[]'::jsonb,                -- [{formato, arquivo_id}]
      rodada INT DEFAULT 1,
      erro TEXT,
      callback_token TEXT,
      criado_em TIMESTAMPTZ DEFAULT now(),
      atualizado_em TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arquivos (
      id SERIAL PRIMARY KEY,
      criativo_id INT,
      tipo TEXT,                                      -- foto | imagem | arte
      nome TEXT,
      mime TEXT,
      token TEXT NOT NULL,                            -- vai na URL pública (o n8n precisa baixar as fotos)
      dados BYTEA NOT NULL,
      criado_em TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS arquivos_criativo ON arquivos (criativo_id);
  `);
  // Prospecção: negócio ainda não cliente. Localizar (candidatos de ficha/Instagram/site) -> confirmar -> coletar
  // (Apify Maps + Instagram, PageSpeed, rastreio do site, no n8n) -> scorecard -> PDF de diagnóstico -> virar cliente.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospects (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      cidade TEXT,
      setor TEXT,
      site TEXT,
      instagram TEXT,                       -- handle confirmado
      gmn JSONB,                            -- ficha confirmada {place_id, nome, endereco, url}
      candidatos JSONB,                     -- resultado da localização {gmn:[], instagram:[], sites:[]}
      estado TEXT NOT NULL DEFAULT 'novo',  -- novo | localizando | localizado | coletando | pronto | erro
      diagnostico JSONB,                    -- dados coletados + notas por frente
      erro TEXT,
      callback_token TEXT,
      cliente_id INT,                       -- preenchido quando vira cliente
      criado_em TIMESTAMPTZ DEFAULT now(),
      atualizado_em TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE documentos_gerados ADD COLUMN IF NOT EXISTS prospect_id INT; -- diagnóstico de prospect (sem cliente_id)
  `);
}

module.exports = { pool, migrar };
