import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { anexarDocumento, buscarCliente, gerarDocumento, listarDocumentos, urlDownload } from '../api.js';

const TIPOS = [
  { tipo: 'relatorio', rotulo: 'Relatório', acao: 'Gerar Relatório' },
  { tipo: 'pesquisa', rotulo: 'Pesquisa de Mercado', acao: 'Gerar Pesquisa de Mercado' },
  { tipo: 'briefing', rotulo: 'Briefing', acao: 'Gerar Briefing' },
];
const ROTULOS = Object.fromEntries(TIPOS.map((t) => [t.tipo, t.rotulo]));

// mesmo filtro do backend (rotas/anexar.js)
const EXTENSOES = ['.pdf', '.docx', '.txt'];

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
  const [anexo, setAnexo] = useState({ estado: 'parado', mensagem: '' }); // parado | enviando | ok | erro
  const [arrastando, setArrastando] = useState(false);
  const inputArquivo = useRef(null);

  useEffect(() => {
    setCliente(null);
    setErro('');
    setAnexo({ estado: 'parado', mensagem: '' });
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

  async function anexar(arquivo) {
    if (!arquivo || anexo.estado === 'enviando') return;
    const ext = arquivo.name.slice(arquivo.name.lastIndexOf('.')).toLowerCase();
    if (!EXTENSOES.includes(ext)) {
      setAnexo({ estado: 'erro', mensagem: `"${arquivo.name}" não é aceito. Envie PDF, DOCX ou TXT.` });
      return;
    }
    setAnexo({ estado: 'enviando', mensagem: `Enviando "${arquivo.name}" — a IA está lendo o arquivo, pode levar até 2 minutos.` });
    try {
      await anexarDocumento(id, arquivo);
      setAnexo({ estado: 'ok', mensagem: `"${arquivo.name}" entrou no cérebro. Os próximos documentos já consideram esse conteúdo.` });
    } catch (e) {
      setAnexo({ estado: 'erro', mensagem: `Não deu para anexar "${arquivo.name}": ${e.message}` });
    } finally {
      if (inputArquivo.current) inputArquivo.current.value = ''; // permite reenviar o mesmo arquivo
    }
  }

  function soltar(e) {
    e.preventDefault();
    setArrastando(false);
    anexar(e.dataTransfer.files?.[0]);
  }

  if (erro) return (
    <>
      <Link to="/" className="voltar">← Clientes</Link>
      <p className="aviso aviso-erro">{erro}</p>
    </>
  );
  if (!cliente) return <p className="vazio">Carregando…</p>;

  const enviando = anexo.estado === 'enviando';

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
            <button key={t.tipo} className="botao" disabled={gerando !== null} onClick={() => gerar(t.tipo)}>
              {gerando === t.tipo ? <><span className="girando" aria-hidden="true" /> Gerando…</> : t.acao}
            </button>
          ))}
        </div>
        {gerando && <p className="aviso" role="status">A IA está montando o documento. Isso pode levar até 2 minutos — não feche a página.</p>}
        {erroGeracao && <p className="aviso aviso-erro" role="alert">{erroGeracao}</p>}
      </section>

      <section className="bloco">
        <h2>Anexar documento pra alimentar a IA</h2>
        <label
          className={`upload${arrastando ? ' upload-arrastando' : ''}${enviando ? ' upload-ocupado' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!enviando) setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={soltar}
        >
          <input
            ref={inputArquivo}
            type="file"
            className="upload-input"
            accept={EXTENSOES.join(',')}
            disabled={enviando}
            onChange={(e) => anexar(e.target.files?.[0])}
          />
          {enviando
            ? <><span className="girando" aria-hidden="true" /> Enviando…</>
            : <span><strong>Escolha um arquivo</strong> ou arraste pra cá · PDF, DOCX ou TXT</span>}
        </label>
        {anexo.mensagem && (
          <p className={`aviso${anexo.estado === 'erro' ? ' aviso-erro' : ''}`} role={anexo.estado === 'erro' ? 'alert' : 'status'}>
            {anexo.mensagem}
          </p>
        )}
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
