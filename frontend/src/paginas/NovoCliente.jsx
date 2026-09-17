import { Link, useNavigate } from 'react-router-dom';
import { criarCliente } from '../api.js';
import FormCliente from './FormCliente.jsx';

export default function NovoCliente() {
  const navegar = useNavigate();

  async function salvar(dados) {
    const cliente = await criarCliente(dados);
    navegar(`/clientes/${cliente.id}`);
  }

  return (
    <>
      <Link to="/" className="voltar">← Clientes</Link>
      <div className="cabecalho-pagina">
        <div>
          <h1>Novo cliente</h1>
          <p className="sub">Só o nome é obrigatório — o resto dá pra completar depois.</p>
        </div>
      </div>
      <section className="bloco">
        <FormCliente rotuloSalvar="Cadastrar cliente" aoSalvar={salvar} aoCancelar={() => navegar('/')} />
      </section>
    </>
  );
}
