import { Link, Route, Routes } from 'react-router-dom';
import ListaClientes from './paginas/ListaClientes.jsx';
import Cliente from './paginas/Cliente.jsx';
import NovoCliente from './paginas/NovoCliente.jsx';

export default function App() {
  return (
    <>
      <header className="topo">
        <Link to="/" className="marca">
          <span className="marca-nome">Feeling</span>
          <span className="marca-produto">Cockpit</span>
        </Link>
      </header>
      <main className="conteudo">
        <Routes>
          <Route path="/" element={<ListaClientes />} />
          <Route path="/clientes/novo" element={<NovoCliente />} />
          <Route path="/clientes/:id" element={<Cliente />} />
          <Route path="*" element={<p className="vazio">Página não encontrada. <Link to="/">Voltar aos clientes</Link></p>} />
        </Routes>
      </main>
    </>
  );
}
