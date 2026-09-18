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
  `);
}

module.exports = { pool, migrar };
