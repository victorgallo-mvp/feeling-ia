import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FormCliente from './FormCliente.jsx';
import { anexarDocumento, atualizarCliente, buscarCliente, gerarDocumento, listarDocumentos, listarTipos, urlDownload } from '../api.js';

const TIPOS = [
  { tipo: 'relatorio', rotulo: 'Relatório', acao: 'Gerar Relatório' },
  { tipo: 'pesquisa', rotulo: 'Pesquisa de Mercado', acao: 'Gerar Pesquisa de Mercado' },
  { tipo: 'briefing', rotulo: 'Briefing', acao: 'Gerar Briefing' },
  { tipo: 'analise', rotulo: 'Análise de Presença Digital', acao: 'Analisar Presença Digital' },
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
  const [editando, setEditando] = useState(false);
  const [ligados, setLigados] = useState(null); // { tipo: bool } — quais documentos têm workflow no n8n
  const inputArquivo = useRef(null);

  useEffect(() => {
    setCliente(null);
    setErro('');
    setAnexo({ estado: 'parado', mensagem: '' });
    setEditando(false);
    Promise.all([buscarCliente(id), listarDocumentos(id)])
      .then(([c, docs]) => { setCliente(c); setDocumentos(docs); })
      .catch((e) => setErro(e.message));
  }, [id]);

  useEffect(() => {
    listarTipos().then(setLigados).catch(() => setLigados(null)); // sem resposta, não bloqueia nada
  }, []);

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

  async function salvarCliente(dados) {
    setCliente(await atualizarCliente(id, dados));
    setEditando(false);
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
  // motivo que impede gerar cada tipo (null = pode gerar)
  const bloqueio = (tipo) => {
    if (ligados && ligados[tipo] === false) return 'em breve';
    if (tipo === 'relatorio' && !cliente.conta_id) return 'falta ID da conta';
    return null;
  };
  const faltando = [
    !cliente.conta_id && 'ID da conta',
    !cliente.setor && 'setor',
    !cliente.cidade && 'cidade',
    !cliente.perfil && 'perfil',
    !cliente.instagram && !cliente.site && 'Instagram ou site',
  ].filter(Boolean);

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
              disabled={gerando !== null || bloqueio(t.tipo) !== null}
              onClick={() => gerar(t.tipo)}
            >
              {gerando === t.tipo ? <><span className="girando" aria-hidden="true" /> Gerando…</> : t.acao}
              {bloqueio(t.tipo) && <span className="etiqueta">{bloqueio(t.tipo)}</span>}
            </button>
          ))}
        </div>
        {!cliente.cidade && !cliente.instagram && !cliente.site && (
          <p className="aviso">Sem cidade, Instagram ou site no cadastro, a análise de presença digital busca só pelo nome e pode achar um homônimo.</p>
        )}
        {gerando && <p className="aviso" role="status">A IA está montando o documento. Isso pode levar até 2 minutos — não feche a página.</p>}
        {erroGeracao && <p className="aviso aviso-erro" role="alert">{erroGeracao}</p>}
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

      <section className="bloco">
        <div className="bloco-topo">
          <h2>Informações do cliente</h2>
          {!editando && <button type="button" className="link" onClick={() => setEditando(true)}>Editar</button>}
        </div>
        {editando ? (
          <FormCliente inicial={cliente} rotuloSalvar="Salvar" aoSalvar={salvarCliente} aoCancelar={() => setEditando(false)} />
        ) : (
          <>
            <dl className="ficha">
              <div><dt>Setor</dt><dd>{cliente.setor || '—'}</dd></div>
              <div><dt>Cidade</dt><dd>{cliente.cidade || '—'}</dd></div>
              <div><dt>ID da conta no Sentinel</dt><dd>{cliente.conta_id ? <code>{cliente.conta_id}</code> : '—'}</dd></div>
              <div><dt>Instagram</dt><dd>{cliente.instagram ? <a href={`https://instagram.com/${cliente.instagram}`} target="_blank" rel="noreferrer">@{cliente.instagram}</a> : '—'}</dd></div>
              <div><dt>Site</dt><dd>{cliente.site ? <a href={cliente.site} target="_blank" rel="noreferrer">{cliente.site.replace(/^https?:\/\//, '')}</a> : '—'}</dd></div>
              <div><dt>ID do Google Ads</dt><dd>{cliente.google_ads_id ? <code>{cliente.google_ads_id}</code> : '—'}</dd></div>
              <div className="ficha-larga"><dt>Perfil</dt><dd className="ficha-perfil">{cliente.perfil || '—'}</dd></div>
            </dl>
            {faltando.length > 0 && (
              <p className="aviso">Falta preencher: {faltando.join(', ')}. Quanto mais completo, menos "[a confirmar com o cliente]" nos documentos.</p>
            )}
          </>
        )}
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
    </>
  );
}
