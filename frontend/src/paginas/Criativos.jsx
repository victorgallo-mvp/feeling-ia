import { useEffect, useRef, useState } from 'react';
import { aprovarImagem, criarCriativo, excluirCriativo, listarCriativos, montarArte, refazerCopy, refazerImagens } from '../api.js';

const OBJETIVOS = [['vendas', 'Vendas (site)'], ['mensagens', 'Mensagens (WhatsApp)'], ['leads', 'Leads (formulário)'], ['reconhecimento', 'Reconhecimento']];
const ESTADO = {
  imagem_gerando: 'gerando imagens…', imagem_pendente: 'escolha uma imagem', copy_gerando: 'escrevendo a copy…',
  copy_pendente: 'escolha a copy', arte_gerando: 'montando a arte…', pronto: 'pronto', erro: 'falhou',
};
const fmtData = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function NovoCriativo({ clienteId, ligado, aoCriar }) {
  const [c, setC] = useState({ titulo: '', objetivo: 'vendas', produto: '', oferta: '', publico: '', formato: 'ambos', estilo: '', referencias: '' });
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
      setC({ titulo: '', objetivo: 'vendas', produto: '', oferta: '', publico: '', formato: 'ambos', estilo: '', referencias: '' }); setFotos([]);
    } catch (err) { setErro(err.message); } finally { setOcupado(false); }
  }

  if (!ligado) return <p className="aviso">Os fluxos de criativo ainda não foram ligados no n8n (N8N_WEBHOOK_CRIATIVO_IMAGEM / _COPY).</p>;
  return (
    <form className="form" onSubmit={enviar}>
      <div className="form-grade">
        <div className="form-campo"><label htmlFor="cr-produto">Produto ou serviço do anúncio</label><input {...campo('produto')} placeholder="ex.: Escapamento esportivo para trail" required /></div>
        <div className="form-campo"><label htmlFor="cr-objetivo">Objetivo</label><select {...campo('objetivo')}>{OBJETIVOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></div>
        <div className="form-campo"><label htmlFor="cr-oferta">Oferta / condição <span className="form-opcional">(opcional)</span></label><input {...campo('oferta')} placeholder="ex.: Frete grátis acima de R$ 299" /></div>
        <div className="form-campo"><label htmlFor="cr-publico">Público <span className="form-opcional">(opcional)</span></label><input {...campo('publico')} placeholder="ex.: Homens 25–45, donos de moto trail" /></div>
        <div className="form-campo"><label htmlFor="cr-formato">Formato</label><select {...campo('formato')}><option value="ambos">Feed + Stories</option><option value="feed">Só Feed (1080×1080)</option><option value="stories">Só Stories (1080×1920)</option></select></div>
        <div className="form-campo"><label htmlFor="cr-titulo">Nome do criativo <span className="form-opcional">(opcional)</span></label><input {...campo('titulo')} placeholder="ex.: Escapamento — setembro" /></div>
        <div className="form-campo form-campo-largo"><label htmlFor="cr-estilo">Direção visual <span className="form-opcional">(opcional)</span></label><input {...campo('estilo')} placeholder="ex.: oficina limpa, luz dramática, peça em destaque; cores da marca" /></div>
        <div className="form-campo form-campo-largo"><label htmlFor="cr-referencias">Referências <span className="form-opcional">(opcional)</span></label><input {...campo('referencias')} placeholder="links de anúncios/posts de referência ou descrição do que gostou" /></div>
        <div className="form-campo form-campo-largo">
          <label htmlFor="cr-fotos">Fotos do produto <span className="form-opcional">(até 3, opcional — a IA descreve e reproduz)</span></label>
          <input id="cr-fotos" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={ocupado} onChange={(e) => setFotos([...(e.target.files || [])].slice(0, 3))} />
          {fotos.length > 0 && <p className="doc-data">{fotos.map((f) => f.name).join(' · ')}</p>}
        </div>
      </div>
      {erro && <p className="aviso aviso-erro">{erro}</p>}
      <div className="acoes form-acoes">
        <button type="submit" className="botao" disabled={ocupado}>{ocupado ? <><span className="girando" aria-hidden="true" /> Enviando…</> : 'Gerar imagens'}</button>
      </div>
      <p className="form-ajuda">Etapas: imagens (2 opções) → você aprova ou pede outra com um comentário → copy (3 variações) → você escolhe e ajusta → arte final para download.</p>
    </form>
  );
}

function Cartao({ c, aoAtualizar, aoExcluir }) {
  const [feedback, setFeedback] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [copy, setCopy] = useState(null); // {headline, texto, cta} em edição
  const aprovada = (c.imagens || []).find((i) => i.aprovada);
  const ultimaRodada = Math.max(1, ...(c.imagens || []).map((i) => i.rodada || 1));
  const imagensAtuais = (c.imagens || []).filter((i) => (i.rodada || 1) === ultimaRodada);

  useEffect(() => { if (c.copy?.escolhida && !copy) setCopy(c.copy.escolhida); }, [c.copy]); // eslint-disable-line react-hooks/exhaustive-deps

  const agir = async (fn) => { setOcupado(true); setErro(''); try { aoAtualizar(await fn()); } catch (e) { setErro(e.message); } finally { setOcupado(false); } };
  const girando = ['imagem_gerando', 'copy_gerando', 'arte_gerando'].includes(c.estado);

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
      {erro && <p className="aviso aviso-erro">{erro}</p>}

      {imagensAtuais.length > 0 && (
        <>
          <h4>Imagens {ultimaRodada > 1 ? `(rodada ${ultimaRodada})` : ''}</h4>
          <div className="grade-imagens">
            {imagensAtuais.map((i) => (
              <figure key={i.arquivo_id} className={`imagem-opcao${i.aprovada ? ' imagem-aprovada' : ''}`}>
                <a href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt="" loading="lazy" /></a>
                <figcaption>
                  {i.aprovada ? <span className="etiqueta etiqueta-ok">aprovada</span>
                    : <button type="button" className="botao botao-secundario" disabled={ocupado || girando} onClick={() => agir(() => aprovarImagem(c.id, i.arquivo_id))}>Aprovar esta</button>}
                </figcaption>
              </figure>
            ))}
          </div>
          {imagensAtuais[0]?.racional && <p className="form-ajuda">Direção da IA: {imagensAtuais[0].racional}</p>}
          {!aprovada && !girando && (
            <div className="linha-feedback">
              <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="o que mudar? ex.: produto maior, fundo mais claro, sem pessoas" disabled={ocupado} />
              <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => agir(async () => { const r = await refazerImagens(c.id, feedback); setFeedback(''); return r; })}>Gerar outras</button>
            </div>
          )}
        </>
      )}

      {c.copy?.variacoes?.length > 0 && aprovada && (
        <>
          <h4>Copy</h4>
          <div className="grade-copy">
            {c.copy.variacoes.map((v, k) => (
              <label key={k} className={`copy-opcao${copy && copy.headline === v.headline && copy.texto === v.texto ? ' copy-escolhida' : ''}`}>
                <input type="radio" name={`copy-${c.id}`} checked={!!copy && copy.headline === v.headline && copy.texto === v.texto} onChange={() => setCopy({ ...v })} disabled={ocupado || girando} />
                <strong>{v.headline}</strong><span>{v.texto}</span><em>{v.cta}</em>
              </label>
            ))}
          </div>
          {copy && (
            <div className="form-grade">
              <div className="form-campo"><label>Headline</label><input value={copy.headline} maxLength={80} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} disabled={ocupado || girando} /></div>
              <div className="form-campo"><label>CTA</label><input value={copy.cta} maxLength={30} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} disabled={ocupado || girando} /></div>
              <div className="form-campo form-campo-largo"><label>Texto de apoio</label><input value={copy.texto} maxLength={200} onChange={(e) => setCopy({ ...copy, texto: e.target.value })} disabled={ocupado || girando} /></div>
            </div>
          )}
          {c.copy.legenda && <p className="form-ajuda"><strong>Legenda sugerida:</strong> {c.copy.legenda}</p>}
          <div className="linha-feedback">
            <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="quer outras copies? diga o ângulo (ex.: mais direto, falar de garantia)" disabled={ocupado || girando} />
            <button type="button" className="botao botao-secundario" disabled={ocupado || girando} onClick={() => agir(async () => { const r = await refazerCopy(c.id, feedback); setFeedback(''); return r; })}>Outras copies</button>
            <button type="button" className="botao" disabled={ocupado || girando || !copy?.headline} onClick={() => agir(() => montarArte(c.id, copy))}>{c.artes?.length ? 'Montar arte de novo' : 'Montar arte'}</button>
          </div>
        </>
      )}

      {c.artes?.length > 0 && (
        <>
          <h4>Arte final</h4>
          <div className="grade-imagens">
            {c.artes.map((a) => (
              <figure key={a.arquivo_id} className="imagem-opcao">
                <a href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt="" loading="lazy" style={{ aspectRatio: `${a.largura} / ${a.altura}` }} /></a>
                <figcaption>{a.formato} {a.largura}×{a.altura} · <a className="link" href={`${a.url}?download=1`}>baixar PNG</a></figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </li>
  );
}

// Seção "Criativos": pipeline com aprovação humana entre cada etapa.
export default function Criativos({ clienteId, ligado }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);
  const timer = useRef(null);

  const carregar = () => listarCriativos(clienteId).then((l) => { setLista(l); setErro(''); }).catch((e) => setErro(e.message));
  useEffect(() => { setLista(null); carregar(); }, [clienteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const temGerando = (lista || []).some((c) => ['imagem_gerando', 'copy_gerando', 'arte_gerando'].includes(c.estado));
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
        : lista.length === 0 ? <p className="vazio">Nenhum criativo ainda. Clique em "Novo criativo": contexto → imagens → copy → arte pronta para download.</p>
        : <ul className="lista-criativos">{lista.map((c) => <Cartao key={c.id} c={c} aoAtualizar={substituir} aoExcluir={async (x) => { try { await excluirCriativo(x.id); setLista((l) => l.filter((y) => y.id !== x.id)); } catch (e) { setErro(e.message); } }} />)}</ul>}
    </section>
  );
}
