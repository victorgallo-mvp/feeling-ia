import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import FormCliente from './FormCliente.jsx';
import Reunioes from './Reunioes.jsx';
import SugestoesCadastro, { itensDe } from './SugestoesCadastro.jsx';
import { anexarDocumento, atualizarCliente, buscarCliente, excluirAnexo, excluirCliente, excluirDocumento, gerarDocumento, listarAnexos, listarDocumentos, listarTipos, registrarSugestaoAnexo, registrarSugestoes, removerPerdidos, resumoExclusao, urlDownload } from '../api.js';

const TIPOS = [
  { tipo: 'relatorio', rotulo: 'Relatório', acao: 'Gerar Relatório' },
  { tipo: 'pesquisa', rotulo: 'Pesquisa de Mercado', acao: 'Gerar Pesquisa de Mercado' },
  { tipo: 'briefing', rotulo: 'Briefing', acao: 'Gerar Briefing' },
  { tipo: 'analise', rotulo: 'Análise de Presença Digital', acao: 'Analisar Presença Digital' },
];
const ROTULOS = { ...Object.fromEntries(TIPOS.map((t) => [t.tipo, t.rotulo])), reuniao: 'Reunião' };
const ABRANGENCIA = { local: 'Local (cidade e região)', regional: 'Regional', nacional: 'Nacional' };

// mesmo filtro do backend (rotas/anexar.js)
const EXTENSOES = ['.pdf', '.docx', '.txt'];

const formatarData = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Cliente() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [cliente, setCliente] = useState(null);
  const [documentos, setDocumentos] = useState([]);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(null); // tipo em geração
  const [erroGeracao, setErroGeracao] = useState('');
  const [novoId, setNovoId] = useState(null);
  const [anexo, setAnexo] = useState({ estado: 'parado', mensagem: '' }); // parado | enviando | ok | erro
  const [arrastando, setArrastando] = useState(false);
  const [extrair, setExtrair] = useState(true); // sugerir cadastro a partir do anexo
  const [tipoAnexo, setTipoAnexo] = useState('anexo'); // anexo (documento do cliente) | relatorio_semanal
  const [periodoRelatorio, setPeriodoRelatorio] = useState(''); // ex.: "14 a 20/09/2026" — vira o título do relatório no cérebro
  const [editando, setEditando] = useState(false);
  const [ligados, setLigados] = useState(null);
  const [filtro, setFiltro] = useState('todos'); // todos | tipo
  const [ocupadoDoc, setOcupadoDoc] = useState(null); // id em exclusão, ou 'perdidos'
  const [anexos, setAnexos] = useState([]); // arquivos deste cliente no cérebro
  const [ocupadoAnexo, setOcupadoAnexo] = useState(null);
  const [excluindoCliente, setExcluindoCliente] = useState(false); // { tipo: bool } — quais documentos têm workflow no n8n
  const inputArquivo = useRef(null);

  useEffect(() => {
    setCliente(null);
    setErro('');
    setAnexo({ estado: 'parado', mensagem: '' });
    setEditando(false);
    Promise.all([buscarCliente(id), listarDocumentos(id), listarAnexos(id).catch(() => [])])
      .then(([c, docs, ax]) => { setCliente(c); setDocumentos(docs); setAnexos(ax); })
      .catch((e) => setErro(e.message));
  }, [id]);

  useEffect(() => {
    listarTipos().then(setLigados).catch(() => setLigados(null)); // sem resposta, não bloqueia nada
  }, []);

  async function gerar(tipo) {
    setGerando(tipo);
    setErroGeracao('');
    try {
      const doc = await gerarDocumento(id, tipo); // 202: o documento nasce "gerando"; o n8n avisa quando terminar
      setDocumentos((atual) => (atual.some((d) => d.id === doc.id) ? atual : [doc, ...atual]));
      setNovoId(doc.id);
    } catch (e) {
      setErroGeracao(`Não deu para gerar: ${e.message}`);
    } finally {
      setGerando(null);
    }
  }

  // Enquanto houver documento "gerando", recarrega a lista a cada 5s até o n8n responder.
  const temGerando = documentos.some((d) => d.estado === 'gerando');
  useEffect(() => {
    if (!temGerando) return undefined;
    const t = setInterval(() => {
      listarDocumentos(id).then((docs) => setDocumentos((atual) => {
        // mantém o realce do "novo" quando ele acabou de ficar pronto
        return docs;
      })).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [temGerando, id]);

  async function tentarDeNovo(doc) {
    setOcupadoDoc(doc.id);
    try {
      await excluirDocumento(doc.id);
      setDocumentos((atual) => atual.filter((d) => d.id !== doc.id));
      await gerar(doc.tipo);
    } catch (e) {
      window.alert(`Não deu para tentar de novo: ${e.message}`);
    } finally {
      setOcupadoDoc(null);
    }
  }

  async function anexar(arquivo) {
    if (!arquivo || anexo.estado === 'enviando') return;
    const ext = arquivo.name.slice(arquivo.name.lastIndexOf('.')).toLowerCase();
    if (!EXTENSOES.includes(ext)) {
      setAnexo({ estado: 'erro', mensagem: `"${arquivo.name}" não é aceito. Envie PDF, DOCX ou TXT.` });
      return;
    }
    // Relatório semanal: entra com o tipo certo, título no padrão da casa e sem extração de cadastro
    // (números da semana não são perfil — foi assim que ROAS e nomes de vendedoras contaminaram o cadastro).
    const relatorio = tipoAnexo === 'relatorio_semanal';
    if (relatorio && !periodoRelatorio.trim()) {
      setAnexo({ estado: 'erro', mensagem: 'Informe o período do relatório (ex.: 14 a 20/09/2026) antes de enviar.' });
      return;
    }
    const opcoes = relatorio
      ? { extrair: false, tipo: 'relatorio_semanal', titulo: `Relatório Semanal - ${cliente.nome} - ${periodoRelatorio.trim()}` }
      : { extrair };
    setAnexo({ estado: 'enviando', mensagem: `Enviando "${arquivo.name}" — a IA está lendo o arquivo${opcoes.extrair ? ' e montando sugestões de cadastro' : ''}, pode levar até 2 minutos.` });
    try {
      const r = await anexarDocumento(id, arquivo, opcoes);
      if (r.sugestoes) setCliente((c) => ({ ...c, sugestoes: [...(c.sugestoes || []), r.sugestoes] }));
      setAnexo({ estado: 'ok', mensagem: `"${arquivo.name}" entrou no cérebro${relatorio ? ` como "${opcoes.titulo}"` : ''}.${r.sugestoes ? ' As sugestões de cadastro estão em "Informações do cliente".' : ''}${r.aviso ? ` (${r.aviso})` : ''}` });
      if (relatorio) setPeriodoRelatorio('');
      listarAnexos(id).then(setAnexos).catch(() => {});
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

  async function excluir(doc) {
    const rotulo = ROTULOS[doc.tipo] || doc.tipo;
    if (!window.confirm(`Excluir "${rotulo}" de ${formatarData(doc.criado_em)}? Não dá pra desfazer.`)) return;
    setOcupadoDoc(doc.id);
    try {
      await excluirDocumento(doc.id);
      setDocumentos((atual) => atual.filter((d) => d.id !== doc.id));
    } catch (e) {
      window.alert(`Não deu para excluir: ${e.message}`);
    } finally {
      setOcupadoDoc(null);
    }
  }

  async function limparPerdidos() {
    const n = documentos.filter((d) => d.estado === 'perdido').length;
    if (!window.confirm(`Remover ${n} ${n === 1 ? 'documento perdido' : 'documentos perdidos'}? Eles não têm PDF nem texto salvo, então não há o que recuperar.`)) return;
    setOcupadoDoc('perdidos');
    try {
      await removerPerdidos(id);
      setDocumentos((atual) => atual.filter((d) => d.estado !== 'perdido'));
    } catch (e) {
      window.alert(`Não deu para remover: ${e.message}`);
    } finally {
      setOcupadoDoc(null);
    }
  }

  async function removerAnexo(a) {
    if (!window.confirm(`Tirar "${a.titulo}" do cérebro deste cliente? Os próximos documentos deixam de considerar esse conteúdo.`)) return;
    setOcupadoAnexo(a.titulo);
    try {
      await excluirAnexo(id, a.titulo);
      setAnexos((atual) => atual.filter((x) => x.titulo !== a.titulo));
    } catch (e) {
      window.alert(`Não deu para remover: ${e.message}`);
    } finally {
      setOcupadoAnexo(null);
    }
  }

  async function apagarCliente() {
    let r = { documentos: documentos.length, anexos: anexos.length, chunks: 0 };
    try { r = await resumoExclusao(id); } catch {}
    const msg = `Excluir o cliente "${cliente.nome}"?\n\nIsso apaga de vez: o cadastro, ${r.documentos} documento(s) gerado(s) com seus PDFs e ${r.anexos} arquivo(s) anexado(s) ao cérebro. Não dá para desfazer.\n\nDigite o nome do cliente para confirmar.`;
    const digitado = window.prompt(msg, '');
    if (digitado === null) return;
    if (digitado.trim().toLowerCase() !== cliente.nome.trim().toLowerCase()) { window.alert('O nome não confere. Nada foi apagado.'); return; }
    setExcluindoCliente(true);
    try {
      await excluirCliente(id);
      navegar('/');
    } catch (e) {
      window.alert(`Não deu para excluir: ${e.message}`);
      setExcluindoCliente(false);
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

  // sugestões pendentes: de reuniões (documentos) e de anexos (cliente.sugestoes)
  const fontes = [];
  for (const d of documentos) {
    if (d.tipo !== 'reuniao' || !d.sugestoes) continue;
    fontes.push({
      chave: `doc:${d.id}`, origem: `reunião "${d.titulo || 'sem assunto'}"${d.data_reuniao ? ` (${d.data_reuniao})` : ''}`,
      resumo: d.sugestoes.resumo_curto, itens: itensDe(d.sugestoes), aplicadas: d.aplicadas || [],
      registrar: (dados) => registrarSugestoes(d.id, dados),
      depois: (dados) => setDocumentos((atual) => atual.map((x) => (x.id === d.id ? { ...x, ...(dados.descartar ? { sugestoes: null, aplicadas: [] } : { aplicadas: dados.aplicadas }) } : x))),
    });
  }
  for (const sg of cliente.sugestoes || []) {
    fontes.push({
      chave: `anexo:${sg.id}`, origem: `arquivo "${sg.origem}"`, resumo: sg.sugestoes?.resumo_curto, itens: itensDe(sg.sugestoes), aplicadas: sg.aplicadas || [],
      registrar: (dados) => registrarSugestaoAnexo(id, sg.id, dados),
      depois: (dados, r) => setCliente((c) => ({ ...c, sugestoes: r?.sugestoes ?? c.sugestoes })),
    });
  }
  const pendentes = fontes.filter((f) => f.itens.some((i) => !f.aplicadas.includes(i.chave)));
  // motivo que impede gerar cada tipo (null = pode gerar)
  const gerandoTipo = (tipo) => documentos.some((d) => d.tipo === tipo && d.estado === 'gerando');
  const bloqueio = (tipo) => {
    if (ligados && ligados[tipo] === false) return 'em breve';
    if (gerandoTipo(tipo)) return 'gerando';
    if (tipo === 'relatorio' && !cliente.conta_id) return 'falta ID da conta';
    return null;
  };
  // derivados da lista de documentos: contagem por tipo, mais recente de cada tipo, perdidos, filtro
  const contagem = {};
  const maisRecente = {}; // tipo -> id do mais novo que ainda tem PDF ou texto (a lista vem em ordem decrescente)
  for (const d of documentos) {
    contagem[d.tipo] = (contagem[d.tipo] || 0) + 1;
    if (!['perdido', 'gerando', 'erro'].includes(d.estado) && !(d.tipo in maisRecente)) maisRecente[d.tipo] = d.id;
  }
  const perdidos = documentos.filter((d) => d.estado === 'perdido').length;
  const visiveis = filtro === 'todos' ? documentos : documentos.filter((d) => d.tipo === filtro);
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
              disabled={gerando === t.tipo || bloqueio(t.tipo) !== null}
              onClick={() => gerar(t.tipo)}
            >
              {gerando === t.tipo || gerandoTipo(t.tipo) ? <><span className="girando" aria-hidden="true" /> {t.acao}</> : t.acao}
              {bloqueio(t.tipo) && bloqueio(t.tipo) !== 'gerando' && <span className="etiqueta">{bloqueio(t.tipo)}</span>}
            </button>
          ))}
        </div>
        {!cliente.cidade && !cliente.instagram && !cliente.site && (
          <p className="aviso">Sem cidade, Instagram ou site no cadastro, a análise de presença digital busca só pelo nome e pode achar um homônimo.</p>
        )}
        {!cliente.perfil && !documentos.some((d) => d.tipo === 'reuniao') && (
          <p className="aviso">Cliente sem perfil e sem reunião registrada: os documentos vão sair cheios de "[a confirmar com o cliente]". Suba a transcrição do onboarding em "Reuniões" ou preencha o perfil primeiro.</p>
        )}
        {temGerando && <p className="aviso" role="status">A IA está montando o documento. Pode levar alguns minutos; a lista abaixo atualiza sozinha e você pode navegar ou fechar a aba — o documento fica salvo.</p>}
        {erroGeracao && <p className="aviso aviso-erro" role="alert">{erroGeracao}</p>}
      </section>

      <section className="bloco">
        <div className="bloco-topo">
          <h2>Documentos gerados</h2>
          {perdidos > 0 && (
            <button type="button" className="link link-erro" disabled={ocupadoDoc !== null} onClick={limparPerdidos}>
              {ocupadoDoc === 'perdidos' ? 'Removendo…' : `Remover ${perdidos} ${perdidos === 1 ? 'perdido' : 'perdidos'}`}
            </button>
          )}
        </div>
        {documentos.length === 0 ? (
          <p className="vazio">Nenhum documento ainda. Gere o primeiro acima.</p>
        ) : (
          <>
            <div className="filtros" role="tablist" aria-label="Filtrar por tipo">
              <button type="button" role="tab" aria-selected={filtro === 'todos'} className={filtro === 'todos' ? 'filtro ativo' : 'filtro'} onClick={() => setFiltro('todos')}>
                Todos <span className="filtro-n">{documentos.length}</span>
              </button>
              {[...TIPOS, { tipo: 'reuniao', rotulo: 'Reunião' }].filter((t) => contagem[t.tipo]).map((t) => (
                <button key={t.tipo} type="button" role="tab" aria-selected={filtro === t.tipo} className={filtro === t.tipo ? 'filtro ativo' : 'filtro'} onClick={() => setFiltro(t.tipo)}>
                  {t.rotulo} <span className="filtro-n">{contagem[t.tipo]}</span>
                </button>
              ))}
            </div>
            <ul className="lista-docs">
              {visiveis.map((d) => (
                <li key={d.id} className={`doc${d.id === novoId && d.estado === 'ok' ? ' doc-novo' : ''}${d.estado === 'perdido' || d.estado === 'erro' ? ' doc-perdido' : ''}`}>
                  <div className="doc-info">
                    <span className="doc-tipo">
                      {ROTULOS[d.tipo] || d.tipo}{d.tipo === 'reuniao' && d.titulo ? ` · ${d.titulo}` : ''}
                      {maisRecente[d.tipo] === d.id && <span className="etiqueta etiqueta-ok">mais recente</span>}
                      {d.estado === 'perdido' && <span className="etiqueta etiqueta-erro">sem arquivo</span>}
                      {d.estado === 'gerando' && <span className="etiqueta etiqueta-ok"><span className="girando girando-mini" aria-hidden="true" /> gerando</span>}
                      {d.estado === 'erro' && <span className="etiqueta etiqueta-erro">falhou</span>}
                    </span>
                    <span className="doc-data">{formatarData(d.criado_em)}{d.estado === 'erro' && d.erro ? ` · ${d.erro}` : ''}</span>
                  </div>
                  <div className="doc-acoes">
                    {d.estado === 'gerando' && <span className="doc-nota">aguardando o n8n…</span>}
                    {d.estado === 'erro' && (
                      <button type="button" className="botao botao-secundario" disabled={ocupadoDoc !== null || gerandoTipo(d.tipo)} onClick={() => tentarDeNovo(d)}>Tentar de novo</button>
                    )}
                    {d.estado === 'perdido' && <span className="doc-nota">PDF perdido — gere de novo</span>}
                    {(d.estado === 'ok' || d.estado === 'regeneravel') && <a className="botao botao-secundario" href={urlDownload(d)}>Baixar PDF</a>}
                    <button type="button" className="link link-erro" disabled={ocupadoDoc !== null} onClick={() => excluir(d)} aria-label={`Excluir ${ROTULOS[d.tipo] || d.tipo} de ${formatarData(d.criado_em)}`}>
                      {ocupadoDoc === d.id ? '…' : 'Excluir'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {visiveis.length === 0 && <p className="vazio">Nenhum documento desse tipo.</p>}
          </>
        )}
      </section>

      <section className="bloco">
        <div className="bloco-topo">
          <h2>Informações do cliente</h2>
          {!editando && <button type="button" className="link" onClick={() => setEditando(true)}>Editar</button>}
        </div>
        {pendentes.map((f) => (
          <SugestoesCadastro key={f.chave} fonte={f} cliente={cliente} aoAtualizarCliente={setCliente} aoRegistrado={(fonte, dados, r) => fonte.depois(dados, r)} />
        ))}
        {editando ? (
          <FormCliente inicial={cliente} rotuloSalvar="Salvar" aoSalvar={salvarCliente} aoCancelar={() => setEditando(false)} />
        ) : (
          <>
            <dl className="ficha">
              <div><dt>Setor</dt><dd>{cliente.setor || '—'}</dd></div>
              <div><dt>Cidade</dt><dd>{cliente.cidade || '—'}</dd></div>
              <div><dt>Abrangência</dt><dd>{ABRANGENCIA[cliente.abrangencia] || 'a IA infere'}</dd></div>
              <div><dt>ID da conta no Sentinel</dt><dd>{cliente.conta_id ? <code>{cliente.conta_id}</code> : '—'}</dd></div>
              <div><dt>Instagram</dt><dd>{cliente.instagram ? <a href={`https://instagram.com/${cliente.instagram}`} target="_blank" rel="noreferrer">@{cliente.instagram}</a> : '—'}</dd></div>
              <div><dt>Site</dt><dd>{cliente.site ? <a href={cliente.site} target="_blank" rel="noreferrer">{cliente.site.replace(/^https?:\/\//, '')}</a> : '—'}</dd></div>
              <div><dt>ID do Google Ads</dt><dd>{cliente.google_ads_id ? <code>{cliente.google_ads_id}</code> : '—'}</dd></div>
              <div className="ficha-larga"><dt>Perfil</dt><dd className="ficha-perfil">{cliente.perfil || '—'}</dd></div>
              <div className="ficha-larga"><dt>Orientações para a IA</dt><dd className="ficha-perfil">{cliente.orientacoes || '—'}</dd></div>
            </dl>
            {faltando.length > 0 && (
              <p className="aviso">Falta preencher: {faltando.join(', ')}. Quanto mais completo, menos "[a confirmar com o cliente]" nos documentos.</p>
            )}
          </>
        )}
      </section>

      <Reunioes
        clienteId={id}
        documentos={documentos}
        ligado={!ligados || ligados.reuniao !== false}
        aoNovoDocumento={(doc) => { setDocumentos((atual) => [doc, ...atual]); setNovoId(doc.id); }}
      />

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
        <div className="form-grade reuniao-campos">
          <div className="form-campo">
            <label htmlFor="anexo-tipo">Tipo do arquivo</label>
            <select id="anexo-tipo" value={tipoAnexo} onChange={(e) => setTipoAnexo(e.target.value)} disabled={enviando}>
              <option value="anexo">Documento do cliente (briefing, benchmark, proposta…)</option>
              <option value="relatorio_semanal">Relatório semanal enviado ao cliente</option>
            </select>
          </div>
          {tipoAnexo === 'relatorio_semanal' && (
            <div className="form-campo">
              <label htmlFor="anexo-periodo">Período do relatório</label>
              <input id="anexo-periodo" value={periodoRelatorio} onChange={(e) => setPeriodoRelatorio(e.target.value)} placeholder="ex.: 14 a 20/09/2026" disabled={enviando} />
            </div>
          )}
        </div>
        {tipoAnexo === 'relatorio_semanal' ? (
          <p className="form-ajuda">Relatórios entram no cérebro como histórico de desempenho e não geram sugestões de cadastro — números da semana não são perfil do cliente.</p>
        ) : (
          <label className="opcao">
            <input type="checkbox" checked={extrair} onChange={(e) => setExtrair(e.target.checked)} disabled={enviando} />
            Sugerir cadastro a partir deste documento (setor, público, concorrentes, diferenciais…)
          </label>
        )}
        {anexo.mensagem && (
          <p className={`aviso${anexo.estado === 'erro' ? ' aviso-erro' : ''}`} role={anexo.estado === 'erro' ? 'alert' : 'status'}>
            {anexo.mensagem}
          </p>
        )}
        {anexos.length > 0 && (
          <ul className="lista-anexos">
            {anexos.map((a) => (
              <li key={a.titulo} className="anexo">
                <div className="doc-info">
                  <span className="doc-tipo">{a.titulo}</span>
                  <span className="doc-data">{a.tipo === 'relatorio_semanal' ? 'relatório semanal' : 'anexo'} · {a.chunks} {a.chunks === 1 ? 'trecho' : 'trechos'} no cérebro</span>
                </div>
                <button type="button" className="link link-erro" disabled={ocupadoAnexo !== null} onClick={() => removerAnexo(a)}>
                  {ocupadoAnexo === a.titulo ? '…' : 'Remover do cérebro'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bloco bloco-perigo">
        <div className="bloco-topo">
          <h2>Excluir cliente</h2>
          <button type="button" className="botao botao-perigo" disabled={excluindoCliente} onClick={apagarCliente}>
            {excluindoCliente ? 'Excluindo…' : 'Excluir cliente'}
          </button>
        </div>
        <p className="vazio">Apaga o cadastro, os documentos gerados e tudo que foi anexado ao cérebro deste cliente. Pede o nome para confirmar.</p>
      </section>
    </>
  );
}
