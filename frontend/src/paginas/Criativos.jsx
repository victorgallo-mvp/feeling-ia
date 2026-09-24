import { useEffect, useRef, useState } from 'react';
import { aprovarCopies, criarCriativo, editarCopy, escolherImagem, excluirCriativo, listarCriativos, montarArtes, refazerCopy, refazerImagens } from '../api.js';

const OBJETIVOS = [['vendas', 'Vendas (site)'], ['mensagens', 'Mensagens (WhatsApp)'], ['leads', 'Leads (formulário)'], ['reconhecimento', 'Reconhecimento']];
const ESTADO = {
  copy_gerando: 'montando as peças…', copy_pendente: 'aprove as peças', imagem_gerando: 'gerando imagens…',
  imagem_pendente: 'escolha as imagens', arte_pendente: 'pronto para montar', arte_gerando: 'montando as artes…',
  pronto: 'pronto', erro: 'falhou',
};
// nome dos blocos, para mostrar como a peça foi composta
const BLOCO = {
  marca: 'logo', titulo: 'título', subtitulo: 'subtítulo', texto: 'parágrafo', imagem: 'foto',
  grade: 'grade', comparativo: 'comparativo', selo: 'selo', lista_check: 'lista com check', cta: 'botão', rodape: 'rodapé',
};
const resumoPeca = (peca) => {
  const nomes = (peca?.blocos || []).flatMap((b) => (b.tipo === 'linha' ? (b.partes || []).map((x) => BLOCO[x.tipo] || x.tipo) : [BLOCO[b.tipo] || b.tipo]));
  return [...new Set(nomes)].join(' · ');
};
const GIRANDO = ['copy_gerando', 'imagem_gerando', 'arte_gerando'];
// o prompt que gerou as imagens desta versão (a escolhida manda; se não escolheu, a primeira)
const promptDe = (imgs) => (imgs.find((i) => i.escolhida) || imgs[0])?.prompt || '';
const fmtData = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function NovoCriativo({ clienteId, ligado, aoCriar }) {
  const vazio = { titulo: '', objetivo: 'vendas', produto: '', oferta: '', publico: '', formato: 'ambos', instrucoes: '' };
  const [c, setC] = useState(vazio);
  const [fotos, setFotos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const campo = (k) => ({ id: `cr-${k}`, value: c[k], onChange: (e) => setC((x) => ({ ...x, [k]: e.target.value })), disabled: ocupado });

  async function enviar(e) {
    e.preventDefault();
    if (!c.produto.trim()) { setErro('Informe o produto ou serviço.'); return; }
    setOcupado(true); setErro('');
    try {
      const novo = await criarCriativo(clienteId, c, fotos);
      aoCriar(novo);
      setC(vazio); setFotos([]);
    } catch (err) { setErro(err.message); } finally { setOcupado(false); }
  }

  if (!ligado) return <p className="aviso">Os fluxos de criativo ainda não foram ligados no n8n (N8N_WEBHOOK_CRIATIVO_COPY / _IMAGEM).</p>;
  return (
    <form className="form" onSubmit={enviar}>
      <div className="form-grade">
        <div className="form-campo"><label htmlFor="cr-produto">Produto ou serviço do anúncio</label><input {...campo('produto')} placeholder="ex.: Escapamento esportivo para trail" required /></div>
        <div className="form-campo"><label htmlFor="cr-objetivo">Objetivo</label><select {...campo('objetivo')}>{OBJETIVOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></div>
        <div className="form-campo"><label htmlFor="cr-oferta">Oferta / condição <span className="form-opcional">(opcional)</span></label><input {...campo('oferta')} placeholder="ex.: Frete grátis acima de R$ 299" /></div>
        <div className="form-campo"><label htmlFor="cr-publico">Público <span className="form-opcional">(opcional)</span></label><input {...campo('publico')} placeholder="ex.: Homens 25–45, donos de moto trail" /></div>
        <div className="form-campo"><label htmlFor="cr-formato">Formato</label><select {...campo('formato')}><option value="ambos">Feed + Stories</option><option value="feed">Só Feed (1080×1080)</option><option value="stories">Só Stories (1080×1920)</option></select></div>
        <div className="form-campo"><label htmlFor="cr-titulo">Nome do criativo <span className="form-opcional">(opcional)</span></label><input {...campo('titulo')} placeholder="ex.: Escapamento — setembro" /></div>
        <div className="form-campo form-campo-largo">
          <label htmlFor="cr-instrucoes">O que você quer neste criativo <span className="form-opcional">(opcional, mas é o campo que mais muda o resultado)</span></label>
          <textarea {...campo('instrucoes')} rows={4} maxLength={4000} placeholder="Escreva com suas palavras, como escreveria no ChatGPT. ex.: fundo vermelho da marca, produto de lado ocupando metade, preço grande no canto superior, sem pessoas, tipografia grossa. Vale colar referência de anúncio que funcionou." />
          <p className="form-ajuda">Isto entra literal no prompt da imagem e ganha do que a IA decidir. Depois de gerar, você ainda vê e edita o prompt completo de cada versão.</p>
        </div>
        <div className="form-campo form-campo-largo">
          <label htmlFor="cr-fotos">Fotos do produto <span className="form-opcional">(até 3, opcional — a foto entra no gerador, o produto real aparece)</span></label>
          <input id="cr-fotos" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={ocupado} onChange={(e) => setFotos([...(e.target.files || [])].slice(0, 3))} />
          {fotos.length > 0 && <p className="doc-data">{fotos.map((f) => f.name).join(' · ')}</p>}
        </div>
      </div>
      {erro && <p className="aviso aviso-erro">{erro}</p>}
      <div className="acoes form-acoes">
        <button type="submit" className="botao" disabled={ocupado}>{ocupado ? <><span className="girando" aria-hidden="true" /> Enviando…</> : 'Montar as peças'}</button>
      </div>
      <p className="form-ajuda">A IA lê o briefing, a análise de presença, a pesquisa, a última reunião e os anexos do cliente e monta 3 peças com ângulos diferentes — escolhendo o que cada caso pede (grade de serviços, comparativo, selo de condição, foto). Você edita e aprova as que quiser. O logo, as cores e o telefone vêm da ficha do cliente.</p>
    </form>
  );
}

// Uma versão de copy: seleção, edição no lugar e o racional da IA.
function VersaoCopy({ c, v, marcada, marcar, travado, aoAtualizar, aoErro }) {
  const [editando, setEditando] = useState(false);
  const [r, setR] = useState(v);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setR(v); }, [v]);

  async function salvar() {
    setSalvando(true);
    try { aoAtualizar(await editarCopy(c.id, v.id, { headline: r.headline, texto: r.texto, cta: r.cta, legenda: r.legenda })); setEditando(false); }
    catch (e) { aoErro(e.message); } finally { setSalvando(false); }
  }

  return (
    <div className={`copy-versao${marcada ? ' copy-escolhida' : ''}${v.aprovada ? ' copy-aprovada' : ''}`}>
      <div className="bloco-topo">
        <label className="copy-titulo">
          <input type="checkbox" checked={marcada} onChange={(e) => marcar(v.id, e.target.checked)} disabled={travado} />
          <strong>{v.angulo}</strong>
          {v.editada && <span className="etiqueta">editada</span>}
          {v.aprovada && <span className="etiqueta etiqueta-ok">aprovada</span>}
        </label>
        {!travado && <button type="button" className="link" onClick={() => setEditando((x) => !x)}>{editando ? 'fechar' : 'editar'}</button>}
      </div>

      {editando ? (
        <div className="form-grade">
          <div className="form-campo"><label>Headline</label><input value={r.headline || ''} maxLength={80} onChange={(e) => setR({ ...r, headline: e.target.value })} /></div>
          <div className="form-campo"><label>CTA</label><input value={r.cta || ''} maxLength={30} onChange={(e) => setR({ ...r, cta: e.target.value })} /></div>
          <div className="form-campo form-campo-largo"><label>Texto de apoio (entra na arte)</label><input value={r.texto || ''} maxLength={200} onChange={(e) => setR({ ...r, texto: e.target.value })} /></div>
          <div className="form-campo form-campo-largo"><label>Legenda do post</label><textarea rows={4} value={r.legenda || ''} maxLength={1200} onChange={(e) => setR({ ...r, legenda: e.target.value })} /></div>
          <div className="form-campo form-campo-largo acoes">
            <button type="button" className="botao botao-secundario" disabled={salvando || !r.headline?.trim()} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar texto'}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="copy-headline">{v.headline}</p>
          {v.texto && <p className="copy-texto">{v.texto}</p>}
          {v.cta && <p className="copy-cta">{v.cta}</p>}
          {v.legenda && <details className="copy-legenda"><summary>legenda do post</summary><p>{v.legenda}</p></details>}
        </>
      )}
      {v.racional && <p className="doc-data"><strong>Por que este ângulo:</strong> {v.racional}</p>}
      {v.peca?.blocos?.length > 0 && <p className="doc-data"><strong>Peça montada com:</strong> {resumoPeca(v.peca)}</p>}
      {v.direcao_imagem && <p className="doc-data"><strong>Foto pedida:</strong> {v.direcao_imagem}</p>}
      {v.peca?.blocos?.length > 0 && !(v.slots || []).length && <p className="doc-data">Sem foto de IA: a composição usa texto e ícones.</p>}
    </div>
  );
}

function Cartao({ c, aoAtualizar, aoExcluir }) {
  const [marcadas, setMarcadas] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [feedbackImg, setFeedbackImg] = useState({});
  const [promptImg, setPromptImg] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  const versoes = c.copy?.versoes || [];
  const rodada = c.copy?.rodada || Math.max(1, ...versoes.map((v) => v.rodada || 1));
  const atuais = versoes.filter((v) => (v.rodada || 1) === rodada);
  const aprovadas = versoes.filter((v) => v.aprovada);
  const girando = GIRANDO.includes(c.estado);
  const travado = girando; // dá para voltar e mudar a seleção depois de aprovar
  const mesmaSelecao = aprovadas.length === marcadas.length && aprovadas.every((v) => marcadas.includes(v.id));

  // Quando as copies chegam, deixa pré-marcada a primeira; depois de aprovar, mostra as aprovadas.
  useEffect(() => {
    if (aprovadas.length) setMarcadas(aprovadas.map((v) => v.id));
    else if (atuais.length && !marcadas.length) setMarcadas([atuais[0].id]);
  }, [c.copy]); // eslint-disable-line react-hooks/exhaustive-deps

  const agir = async (fn) => { setOcupado(true); setErro(''); try { aoAtualizar(await fn()); } catch (e) { setErro(e.message); } finally { setOcupado(false); } };
  const marcar = (id, ligar) => setMarcadas((m) => (ligar ? [...new Set([...m, id])] : m.filter((x) => x !== id)));
  const imagensDe = (id) => (c.imagens || []).filter((i) => i.versao_id === id);
  const artesDe = (id) => (c.artes || []).filter((a) => a.versao_id === id);
  const faltaEscolher = aprovadas.filter((v) => imagensDe(v.id).length > 1 && !imagensDe(v.id).some((i) => i.escolhida));

  return (
    <li className="criativo">
      <div className="bloco-topo">
        <div className="doc-info">
          <span className="doc-tipo">{c.titulo}</span>
          <span className="doc-data">{fmtData(c.criado_em)} · {c.contexto?.objetivo} · {c.contexto?.formato === 'ambos' ? 'feed + stories' : c.contexto?.formato}</span>
        </div>
        <div className="doc-acoes">
          <span className={`etiqueta${c.estado === 'erro' ? ' etiqueta-erro' : c.estado === 'pronto' ? ' etiqueta-ok' : ''}`}>{girando && <span className="girando girando-mini" aria-hidden="true" />} {ESTADO[c.estado] || c.estado}</span>
          <button type="button" className="link" disabled={ocupado} onClick={() => { if (window.confirm(`Excluir o criativo "${c.titulo}"?`)) aoExcluir(c); }}>excluir</button>
        </div>
      </div>
      {c.estado === 'erro' && <p className="aviso aviso-erro">{c.erro}</p>}
      {c.estado !== 'erro' && c.erro && <p className="aviso">{c.erro}</p>}
      {erro && <p className="aviso aviso-erro">{erro}</p>}

      {atuais.length > 0 && (
        <>
          <h4>Copy {rodada > 1 ? `(rodada ${rodada})` : ''}</h4>
          {c.copy?.fontes?.length > 0 && <p className="form-ajuda">Escrita com base em: {c.copy.fontes.join(' · ')}.</p>}
          <div className="grade-copy">
            {atuais.map((v) => (
              <VersaoCopy key={v.id} c={c} v={v} marcada={marcadas.includes(v.id)} marcar={marcar} travado={travado || ocupado} aoAtualizar={aoAtualizar} aoErro={setErro} />
            ))}
          </div>
          {!girando && (
            <div className="linha-feedback">
              {!aprovadas.length && (
                <>
                  <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="outros ângulos? ex.: mais direto, falar de garantia, tom menos formal" disabled={ocupado} />
                  <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => agir(async () => { const r = await refazerCopy(c.id, feedback); setFeedback(''); return r; })}>Outras peças</button>
                </>
              )}
              <button type="button" className="botao" disabled={ocupado || !marcadas.length || mesmaSelecao} onClick={() => agir(() => aprovarCopies(c.id, marcadas))}>
                {aprovadas.length ? 'Atualizar seleção e gerar' : `Aprovar ${marcadas.length > 1 ? `as ${marcadas.length} ` : ''}e gerar imagens`}
              </button>
              {aprovadas.length > 0 && mesmaSelecao && <span className="doc-data">marque outro ângulo para acrescentar um criativo</span>}
            </div>
          )}
        </>
      )}

      {aprovadas.map((v) => {
        const imgs = imagensDe(v.id);
        if (!imgs.length) return girando ? <p key={v.id} className="doc-data">{v.angulo}: gerando imagens…</p> : null;
        return (
          <div key={v.id} className="bloco-versao">
            <h4>{v.angulo} — imagens</h4>
            <div className="grade-imagens">
              {imgs.map((i) => (
                <figure key={i.arquivo_id} className={`imagem-opcao${i.escolhida ? ' imagem-aprovada' : ''}`}>
                  <a href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt="" loading="lazy" /></a>
                  <figcaption>
                    {i.direcao && <span className="doc-data">{i.direcao}</span>}
                    {i.escolhida ? <span className="etiqueta etiqueta-ok">escolhida</span>
                      : <button type="button" className="botao botao-secundario" disabled={ocupado || girando} onClick={() => agir(() => escolherImagem(c.id, i.arquivo_id))}>Usar esta</button>}
                  </figcaption>
                </figure>
              ))}
            </div>
            {!girando && (
              <>
                <div className="linha-feedback">
                  <input value={feedbackImg[v.id] || ''} onChange={(e) => setFeedbackImg((f) => ({ ...f, [v.id]: e.target.value }))} placeholder="o que mudar na imagem? ex.: produto maior, fundo claro, sem pessoas" disabled={ocupado} />
                  <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => agir(async () => { const r = await refazerImagens(c.id, v.id, feedbackImg[v.id] || ''); setFeedbackImg((f) => ({ ...f, [v.id]: '' })); return r; })}>Gerar outras</button>
                </div>
                {/* O prompt é o produto: fica à vista, editável, e vai literal para o gerador. */}
                <details className="copy-legenda">
                  <summary>prompt usado — editar e gerar de novo</summary>
                  <textarea rows={8} className="campo-prompt" disabled={ocupado}
                    value={promptImg[v.id] ?? promptDe(imgs)}
                    onChange={(e) => setPromptImg((p) => ({ ...p, [v.id]: e.target.value }))} />
                  <div className="acoes">
                    <button type="button" className="botao botao-secundario" disabled={ocupado || !(promptImg[v.id] ?? promptDe(imgs)).trim()}
                      onClick={() => agir(() => refazerImagens(c.id, v.id, '', promptImg[v.id] ?? promptDe(imgs)))}>Gerar com este prompt</button>
                    {promptImg[v.id] !== undefined && promptImg[v.id] !== promptDe(imgs) &&
                      <button type="button" className="link" disabled={ocupado} onClick={() => setPromptImg((p) => { const { [v.id]: _, ...resto } = p; return resto; })}>voltar ao original</button>}
                  </div>
                  <p className="form-ajuda">Escreveu você? Vai literal para o gerador, sem a IA reescrever. As {imgs.length} imagens saem deste mesmo prompt.</p>
                </details>
              </>
            )}
          </div>
        );
      })}

      {aprovadas.length > 0 && !girando && ['imagem_pendente', 'arte_pendente', 'pronto', 'erro'].includes(c.estado) && (
        <div className="linha-feedback">
          <button type="button" className="botao" disabled={ocupado || faltaEscolher.length > 0} onClick={() => agir(() => montarArtes(c.id))}>
            {c.artes?.length ? 'Montar as artes de novo' : `Montar ${aprovadas.length > 1 ? `as ${aprovadas.length} artes` : 'a arte'}`}
          </button>
          {faltaEscolher.length > 0 && <span className="doc-data">escolha a imagem de: {faltaEscolher.map((v) => v.angulo).join(', ')}</span>}
        </div>
      )}

      {c.artes?.length > 0 && (
        <>
          <h4>Artes</h4>
          {aprovadas.map((v) => artesDe(v.id).length > 0 && (
            <div key={v.id} className="bloco-versao">
              <p className="doc-data">{v.angulo} — {v.headline}</p>
              <div className="grade-imagens">
                {artesDe(v.id).map((a) => (
                  <figure key={a.arquivo_id} className="imagem-opcao">
                    <a href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt="" loading="lazy" style={{ aspectRatio: `${a.largura} / ${a.altura}` }} /></a>
                    <figcaption>{a.formato} {a.largura}×{a.altura} · <a className="link" href={`${a.url}?download=1`}>baixar PNG</a></figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </li>
  );
}

// Seção "Criativos": copy primeiro (3 ângulos a partir do material do cliente), aprovação humana em lote, depois imagem e arte.
export default function Criativos({ clienteId, ligado }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);
  const timer = useRef(null);

  const carregar = () => listarCriativos(clienteId).then((l) => { setLista(l); setErro(''); }).catch((e) => setErro(e.message));
  useEffect(() => { setLista(null); carregar(); }, [clienteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const temGerando = (lista || []).some((c) => GIRANDO.includes(c.estado));
  useEffect(() => {
    clearInterval(timer.current);
    if (temGerando) timer.current = setInterval(carregar, 6000);
    return () => clearInterval(timer.current);
  }, [temGerando]); // eslint-disable-line react-hooks/exhaustive-deps

  const substituir = (c) => setLista((l) => (l || []).map((x) => (x.id === c.id ? c : x)));

  return (
    <section className="bloco">
      <div className="bloco-topo">
        <h2>Criativos</h2>
        <button type="button" className="botao" onClick={() => setMostrarForm((v) => !v)}>{mostrarForm ? 'Fechar' : 'Novo criativo'}</button>
      </div>
      {mostrarForm && <NovoCriativo clienteId={clienteId} ligado={ligado} aoCriar={(c) => { setLista((l) => [c, ...(l || [])]); setMostrarForm(false); }} />}
      {erro && <p className="aviso aviso-erro">{erro}</p>}
      {lista === null ? <p className="vazio">Carregando…</p>
        : lista.length === 0 ? <p className="vazio">Nenhum criativo ainda. Clique em "Novo criativo": a IA escreve 3 copies a partir do material do cliente, você aprova as que quiser e cada uma vira imagem e arte.</p>
        : <ul className="lista-criativos">{lista.map((c) => <Cartao key={c.id} c={c} aoAtualizar={substituir} aoExcluir={async (x) => { try { await excluirCriativo(x.id); setLista((l) => l.filter((y) => y.id !== x.id)); } catch (e) { setErro(e.message); } }} />)}</ul>}
    </section>
  );
}
