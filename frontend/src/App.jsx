import { Link, NavLink, Route, Routes } from 'react-router-dom';
import ListaClientes from './paginas/ListaClientes.jsx';
import Cliente from './paginas/Cliente.jsx';
import NovoCliente from './paginas/NovoCliente.jsx';
import { ListaProspects, Prospect } from './paginas/Prospeccao.jsx';

export default function App() {
  return (
    <>
      <header className="topo">
        <div className="topo-interno">
        <Link to="/" className="marca">
          <span className="marca-nome">Feeling</span>
          <span className="marca-produto">Cockpit</span>
        </Link>
        <nav className="abas">
          <NavLink to="/" end className={({ isActive }) => `aba${isActive ? ' aba-ativa' : ''}`}>Clientes</NavLink>
          <NavLink to="/prospeccao" className={({ isActive }) => `aba${isActive ? ' aba-ativa' : ''}`}>Prospecção</NavLink>
        </nav>
        </div>
      </header>
      <main className="conteudo">
        <Routes>
          <Route path="/" element={<ListaClientes />} />
          <Route path="/clientes/novo" element={<NovoCliente />} />
          <Route path="/clientes/:id" element={<Cliente />} />
          <Route path="/prospeccao" element={<ListaProspects />} />
          <Route path="/prospeccao/:id" element={<Prospect />} />
          <Route path="*" element={<p className="vazio">Página não encontrada. <Link to="/">Voltar aos clientes</Link></p>} />
        </Routes>
      </main>
    </>
  );
}
