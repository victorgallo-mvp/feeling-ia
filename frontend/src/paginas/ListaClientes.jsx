import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarClientes } from '../api.js';

export default function ListaClientes() {
  const [clientes, setClientes] = useState(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    listarClientes().then(setClientes).catch((e) => setErro(e.message));
  }, []);

  if (erro) return <p className="aviso aviso-erro">{erro}</p>;
  if (!clientes) return <p className="vazio">Carregando clientes…</p>;

  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? clientes.filter((c) => [c.nome, c.setor, c.cidade].some((v) => v?.toLowerCase().includes(termo)))
    : clientes;

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Clientes</h1>
          <p className="sub">{clientes.length} {clientes.length === 1 ? 'cliente' : 'clientes'} no cérebro</p>
        </div>
        <div className="cabecalho-acoes">
          <input
            className="busca"
            type="search"
            placeholder="Buscar por nome, setor ou cidade"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Link to="/clientes/novo" className="botao">Novo cliente</Link>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <p className="vazio">{clientes.length ? 'Nenhum cliente bate com a busca.' : 'Nenhum cliente cadastrado ainda. Comece por "Novo cliente".'}</p>
      ) : (
        <ul className="grade-clientes">
          {visiveis.map((c) => (
            <li key={c.id}>
              <Link to={`/clientes/${c.id}`} className="cartao-cliente">
                <span className="cliente-nome">{c.nome}</span>
                <span className="cliente-meta">{[c.setor, c.cidade].filter(Boolean).join(' · ') || '—'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
