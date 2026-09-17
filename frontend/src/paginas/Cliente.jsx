import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { buscarCliente, gerarDocumento, listarDocumentos, urlDownload } from '../api.js';

// ativo: false = ainda stubado no backend (passo 4 da ordem de construção)
const TIPOS = [
  { tipo: 'relatorio', rotulo: 'Relatório', acao: 'Gerar Relatório', ativo: true },
  { tipo: 'pesquisa', rotulo: 'Pesquisa de Mercado', acao: 'Gerar Pesquisa de Mercado', ativo: false },
  { tipo: 'briefing', rotulo: 'Briefing', acao: 'Gerar Briefing', ativo: false },
];
const ROTULOS = Object.fromEntries(TIPOS.map((t) => [t.tipo, t.rotulo]));

const formatarData = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Cliente() {
  const { id } = useParams();
  const [cliente, setCliente] = useState(null);
  const [documentos, setDocumentos] = useState([]);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(null); // tipo em geração
  const [erroGeracao, setErroGeracao] = useState('');
  const [novoId, setNovoId] = useState(null);

  useEffect(() => {
    setCliente(null);
    setErro('');
    Promise.all([buscarCliente(id), listarDocumentos(id)])
      .then(([c, docs]) => { setCliente(c); setDocumentos(docs); })
      .catch((e) => setErro(e.message));
  }, [id]);

  async function gerar(tipo) {
    setGerando(tipo);
    setErroGeracao('');
    try {
      const doc = await gerarDocumento(id, tipo);
      setDocumentos((atual) => [doc, ...atual]);
      setNovoId(doc.id);
    } catch (e) {
      setErroGeracao(`Não deu para gerar: ${e.message}`);
    } finally {
      setGerando(null);
    }
  }

  if (erro) return (
    <>
      <Link to="/" className="voltar">← Clientes</Link>
      <p className="aviso aviso-erro">{erro}</p>
    </>
  );
  if (!cliente) return <p className="vazio">Carregando…</p>;

  return (
    <>
      <Link to="/" className="voltar">← Clientes</Link>
      <div className="cabecalho-pagina">
        <div>
          <h1>{cliente.nome}</h1>
          <p className="sub">{[cliente.setor, cliente.cidade].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      </div>

      <section className="bloco">
        <h2>Gerar documento</h2>
        <div className="acoes">
          {TIPOS.map((t) => (
            <button
              key={t.tipo}
              className="botao"
              disabled={!t.ativo || gerando !== null}
              onClick={() => gerar(t.tipo)}
            >
              {gerando === t.tipo ? <><span className="girando" aria-hidden="true" /> Gerando…</> : t.acao}
              {!t.ativo && <span className="etiqueta">em breve</span>}
            </button>
          ))}
        </div>
        {gerando && <p className="aviso" role="status">A IA está montando o documento. Isso pode levar até 2 minutos — não feche a página.</p>}
        {erroGeracao && <p className="aviso aviso-erro" role="alert">{erroGeracao}</p>}
      </section>

      <section className="bloco">
        <h2>Anexar documento pra alimentar a IA</h2>
        <div className="upload upload-inativo">
          <span>Upload de arquivos</span>
          <span className="etiqueta">em breve</span>
        </div>
      </section>

      <section className="bloco">
        <h2>Documentos gerados</h2>
        {documentos.length === 0 ? (
          <p className="vazio">Nenhum documento ainda. Gere o primeiro acima.</p>
        ) : (
          <ul className="lista-docs">
            {documentos.map((d) => (
              <li key={d.id} className={d.id === novoId ? 'doc doc-novo' : 'doc'}>
                <div>
                  <span className="doc-tipo">{ROTULOS[d.tipo] || d.tipo}</span>
                  <span className="doc-data">{formatarData(d.criado_em)}</span>
                </div>
                <a className="botao botao-secundario" href={urlDownload(d)}>Baixar PDF</a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
