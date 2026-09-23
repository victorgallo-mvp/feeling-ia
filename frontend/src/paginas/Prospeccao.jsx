import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { atualizarProspect, buscarProspect, coletarProspect, confirmarProspect, criarProspect, excluirProspect, gerarDiagnostico, listarProspects, listarTipos, localizarProspect, urlDownload, virarCliente } from '../api.js';

const ESTADO = { novo: 'novo', localizando: 'localizando…', localizado: 'localizado', coletando: 'coletando dados…', pronto: 'diagnóstico pronto', erro: 'falhou' };
const fmtData = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const corNota = (n) => (n == null ? '' : n >= 70 ? 'nota-boa' : n >= 40 ? 'nota-media' : 'nota-ruim');

// Lista de prospects + cadastro rápido.
export function ListaProspects() {
  const navegar = useNavigate();
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState({ nome: '', cidade: '', setor: '', site: '', instagram: '' });
  const [ocupado, setOcupado] = useState(false);
  const campo = (k) => ({ id: `pr-${k}`, value: form[k], onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })), disabled: ocupado, autoComplete: 'off' });

  useEffect(() => { listarProspects().then(setLista).catch((e) => setErro(e.message)); }, []);

  async function criar(e) {
    e.preventDefault();
    if (!form.nome.trim()) return;
    setOcupado(true);
    try { const p = await criarProspect(form); navegar(`/prospeccao/${p.id}`); } catch (err) { setErro(err.message); setOcupado(false); }
  }

  return (
    <>
      <div className="cabecalho-pagina">
        <div><h1>Prospecção</h1><p className="sub">Diagnóstico de presença digital antes da reunião: Google Meu Negócio, Instagram e site. Se não existir, isso também é diagnóstico.</p></div>
      </div>
      <section className="bloco">
        <h2>Novo prospect</h2>
        <form className="form" onSubmit={criar}>
          <div className="form-grade">
            <div className="form-campo"><label htmlFor="pr-nome">Nome do negócio</label><input {...campo('nome')} required placeholder="ex.: Pastelaria Universal" /></div>
            <div className="form-campo"><label htmlFor="pr-cidade">Cidade</label><input {...campo('cidade')} placeholder="ex.: Divinópolis - MG" /></div>
            <div className="form-campo"><label htmlFor="pr-setor">Setor</label><input {...campo('setor')} placeholder="ex.: pastelaria / clínica odontológica" /></div>
            <div className="form-campo"><label htmlFor="pr-instagram">Instagram <span className="form-opcional">(se souber)</span></label><input {...campo('instagram')} placeholder="@perfil" /></div>
            <div className="form-campo"><label htmlFor="pr-site">Site <span className="form-opcional">(se souber)</span></label><input {...campo('site')} placeholder="www.negocio.com.br" /></div>
          </div>
          <div className="acoes form-acoes"><button type="submit" className="botao" disabled={ocupado}>{ocupado ? 'Criando…' : 'Cadastrar e localizar'}</button></div>
        </form>
      </section>
      <section className="bloco">
        <h2>Prospects</h2>
        {erro && <p className="aviso aviso-erro">{erro}</p>}
        {lista === null ? <p className="vazio">Carregando…</p> : lista.length === 0 ? <p className="vazio">Nenhum prospect ainda.</p> : (
          <ul className="lista-anexos">
            {lista.map((p) => (
              <li key={p.id} className="anexo">
                <div className="doc-info">
                  <Link to={`/prospeccao/${p.id}`} className="doc-tipo">{p.nome}</Link>
                  <span className="doc-data">{[p.setor, p.cidade].filter(Boolean).join(' · ') || '—'} · {fmtData(p.atualizado_em)}</span>
                </div>
                <div className="doc-acoes">
                  {p.diagnostico?.potencial?.nivel && <span className="etiqueta" title="potencial de oportunidade">potencial {p.diagnostico.potencial.nivel}</span>}
                  {p.diagnostico?.notas?.geral != null && <span className={`etiqueta ${corNota(p.diagnostico.notas.geral)}`}>nota {p.diagnostico.notas.geral}</span>}
                  {p.cliente_id ? <Link className="link" to={`/clientes/${p.cliente_id}`}>virou cliente</Link> : <span className={`etiqueta${p.estado === 'erro' ? ' etiqueta-erro' : ''}`}>{ESTADO[p.estado] || p.estado}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Candidatos({ p, aoConfirmar, ocupado }) {
  const c = p.candidatos || { gmn: [], instagram: [], sites: [] };
  const [gmn, setGmn] = useState(p.gmn && !p.gmn.inexistente ? JSON.stringify(p.gmn) : (p.gmn?.inexistente ? 'nenhum' : (c.gmn[0] ? JSON.stringify(c.gmn[0]) : '')));
  const [ig, setIg] = useState(p.instagram || c.instagram[0]?.username || '');
  const [igOutro, setIgOutro] = useState('');
  const [site, setSite] = useState(p.site || c.sites[0]?.url || '');
  const [siteOutro, setSiteOutro] = useState('');
  const pct = (x) => (x.informado ? 'informado por você' : `${Math.round((x.confianca || 0) * 100)}%`);
  const tudoPreenchido = !!(gmn && ig && site);
  const igFinal = ig === 'outro' ? igOutro.replace(/^@/, '').trim() : ig === 'nenhum' ? '' : ig;
  const siteFinal = site === 'outro' ? siteOutro.trim() : site === 'nenhum' ? '' : site;
  return (
    <div className="form">
      <h3>{tudoPreenchido ? 'Confirme (já vem pré-selecionado)' : 'Confirme o que foi encontrado'}</h3>
      <p className="form-ajuda">Candidatos da busca por nome + cidade, com a confiança de cada um. Se nenhum for o negócio certo, escolha "não tem" — a ausência entra no diagnóstico. Nome ou cidade errados? Edite os dados e localize de novo.</p>
      <div className="form-grade">
        <div className="form-campo form-campo-largo">
          <label>Ficha no Google Meu Negócio</label>
          {c.gmn.length === 0 && <p className="doc-data">Nenhuma ficha encontrada para "{p.nome}" em "{p.cidade || 'cidade não informada'}".</p>}
          {c.gmn.map((g, i) => (
            <label key={i} className="opcao"><input type="radio" name="gmn" checked={gmn === JSON.stringify(g)} onChange={() => setGmn(JSON.stringify(g))} disabled={ocupado} /> <strong>{g.nome}</strong> · {g.endereco || g.categoria || ''} <span className="doc-data">({pct(g)})</span></label>
          ))}
          <label className="opcao"><input type="radio" name="gmn" checked={gmn === 'nenhum'} onChange={() => setGmn('nenhum')} disabled={ocupado} /> Não tem ficha no Google</label>
        </div>
        <div className="form-campo">
          <label>Instagram</label>
          {c.instagram.map((x, i) => (
            <label key={i} className="opcao"><input type="radio" name="ig" checked={ig === x.username} onChange={() => setIg(x.username)} disabled={ocupado} /> @{x.username} <span className="doc-data">({pct(x)})</span></label>
          ))}
          <label className="opcao"><input type="radio" name="ig" checked={ig === 'outro'} onChange={() => setIg('outro')} disabled={ocupado} /> Outro: <input value={igOutro} onChange={(e) => { setIgOutro(e.target.value); setIg('outro'); }} placeholder="@perfil" disabled={ocupado} /></label>
          <label className="opcao"><input type="radio" name="ig" checked={ig === 'nenhum'} onChange={() => setIg('nenhum')} disabled={ocupado} /> Não tem Instagram</label>
        </div>
        <div className="form-campo">
          <label>Site</label>
          {c.sites.map((x, i) => (
            <label key={i} className="opcao"><input type="radio" name="site" checked={site === x.url} onChange={() => setSite(x.url)} disabled={ocupado} /> {x.url.replace(/^https?:\/\//, '')} <span className="doc-data">({pct(x)})</span></label>
          ))}
          <label className="opcao"><input type="radio" name="site" checked={site === 'outro'} onChange={() => setSite('outro')} disabled={ocupado} /> Outro: <input value={siteOutro} onChange={(e) => { setSiteOutro(e.target.value); setSite('outro'); }} placeholder="www…" disabled={ocupado} /></label>
          <label className="opcao"><input type="radio" name="site" checked={site === 'nenhum'} onChange={() => setSite('nenhum')} disabled={ocupado} /> Não tem site</label>
        </div>
      </div>
      <div className="acoes">
        <button type="button" className="botao" disabled={ocupado || !gmn || !ig || !site} onClick={() => aoConfirmar({
          gmn: gmn === 'nenhum' ? null : JSON.parse(gmn), sem_gmn: gmn === 'nenhum',
          instagram: igFinal || null, sem_instagram: !igFinal, site: siteFinal || null, sem_site: !siteFinal,
        })}>Confirmar e coletar dados</button>
      </div>
    </div>
  );
}

// Pilares do diagnóstico com os pesos do padrão da casa.
const PILARES = [
  ['google', 'Google e SEO local', 20],
  ['instagram', 'Instagram', 20],
  ['reputacao', 'Reputação', 15],
  ['conteudo', 'Conteúdo', 15],
  ['site', 'Site', 15],
  ['conversao', 'Conversão e jornada', 10],
  ['concorrencia', 'Concorrência', 5],
];
const ETAPAS = { descoberta: 'Descoberta', interesse: 'Interesse', confianca: 'Confiança', consideracao: 'Consideração', conversao: 'Conversão', atendimento: 'Atendimento' };
const OCULTOS = ['achados', 'completude', 'existe', 'bruto', 'motivo', 'buscas', 'url'];
const valor = (v) => (typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v));

// Sub-bloco para objetos rasos (distribuição de notas, formatos, Core Web Vitals, estrutura do site…).
function Miudos({ titulo, obj }) {
  const itens = Object.entries(obj || {}).filter(([, v]) => v != null && v !== '' && typeof v !== 'object');
  if (!itens.length) return null;
  return <p className="doc-data"><strong>{titulo}:</strong> {itens.map(([k, v]) => `${k.replace(/_/g, ' ')} ${valor(v)}`).join(' · ')}</p>;
}

function Frente({ titulo, pilar, peso, nota, dados, achados, children }) {
  if (!dados) return null;
  const fatos = Object.entries(dados).filter(([k, v]) => !OCULTOS.includes(k) && v != null && v !== '' && typeof v !== 'object');
  const meus = (achados || []).filter((a) => a.pilar === pilar);
  return (
    <div className="frente">
      <div className="bloco-topo">
        <h3>{titulo} <span className="doc-data">peso {peso}%</span></h3>
        {nota != null && <span className={`etiqueta ${corNota(nota)}`}>{nota}/100 · {(nota / 20).toFixed(1)} de 5</span>}
      </div>
      {dados.existe === false ? <p className="aviso aviso-erro">{dados.motivo || 'Não encontrado — o negócio não tem esta presença.'}</p> : (
        <>
          {fatos.length > 0 && <dl className="fatos">{fatos.map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{valor(v)}</dd></div>)}</dl>}
          {dados.completude?.itens && <p className="doc-data"><strong>Completude {dados.completude.pct}%:</strong> tem {dados.completude.itens.filter((i) => i.ok).map((i) => i.nome).join(', ') || '—'}{dados.completude.itens.some((i) => !i.ok) ? ` · falta ${dados.completude.itens.filter((i) => !i.ok).map((i) => i.nome).join(', ')}` : ''}</p>}
          {children}
        </>
      )}
      {meus.length > 0 && <ul className="lista-simples">{meus.map((a, i) => <li key={i}>{a.problema} <span className="doc-data">— {a.impacto}</span></li>)}</ul>}
    </div>
  );
}

// "Quem aparece quando o cliente procura": o argumento mais forte da reunião.
function TabelaBuscas({ buscas }) {
  if (!buscas?.length) return null;
  return (
    <div className="tabela-rolagem"><table className="tabela">
      <thead><tr><th>Busca do cliente</th><th>Posição</th><th>Concorrentes à frente</th></tr></thead>
      <tbody>{buscas.map((b, i) => (
        <tr key={i} className={b.posicao == null ? 'linha-detalhe' : ''}>
          <td>{b.busca}</td>
          <td>{b.posicao == null ? 'não aparece' : `${b.posicao}º de ${b.analisados}`}</td>
          <td>{b.concorrentes_a_frente?.length ? b.concorrentes_a_frente.map((c) => `${c.nome} (${c.nota ?? '—'}/${c.avaliacoes ?? '—'})`).join(' · ') : '—'}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

// Página do prospect: localizar -> confirmar -> coletar -> scorecard -> documento -> virar cliente.
export function Prospect() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [p, setP] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [ligados, setLigados] = useState(null);
  const [editando, setEditando] = useState(false);
  const timer = useRef(null);

  const carregar = () => buscarProspect(id).then((x) => { setP(x); setErro(''); }).catch((e) => setErro(e.message));
  useEffect(() => { setP(null); carregar(); listarTipos().then(setLigados).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const emAndamento = p && (p.estado === 'coletando' || (p.documentos || []).some((d) => d.estado === 'gerando'));
  useEffect(() => { clearInterval(timer.current); if (emAndamento) timer.current = setInterval(carregar, 6000); return () => clearInterval(timer.current); }, [emAndamento]); // eslint-disable-line react-hooks/exhaustive-deps

  const agir = async (fn, depois) => { setOcupado(true); setErro(''); try { const r = await fn(); if (depois) depois(r); else await carregar(); } catch (e) { setErro(e.message); await carregar(); } finally { setOcupado(false); } };

  if (!p) return <><Link to="/prospeccao" className="voltar">← Prospecção</Link>{erro ? <p className="aviso aviso-erro">{erro}</p> : <p className="vazio">Carregando…</p>}</>;
  const d = p.diagnostico;
  const ligado = !ligados || ligados.prospeccao !== false;

  return (
    <>
      <Link to="/prospeccao" className="voltar">← Prospecção</Link>
      <div className="cabecalho-pagina">
        <div><h1>{p.nome}</h1><p className="sub">{[p.setor, p.cidade].filter(Boolean).join(' · ') || '—'} · <span className={`etiqueta${p.estado === 'erro' ? ' etiqueta-erro' : ''}`}>{ESTADO[p.estado] || p.estado}</span></p></div>
        <div className="doc-acoes">
          {p.cliente_id ? <Link className="botao botao-secundario" to={`/clientes/${p.cliente_id}`}>Abrir cliente</Link>
            : <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => { if (window.confirm(`Criar o cliente "${p.nome}" com os dados do diagnóstico?`)) agir(() => virarCliente(p.id), (r) => navegar(`/clientes/${r.cliente.id}`)); }}>Virar cliente</button>}
          <button type="button" className="link" disabled={ocupado} onClick={() => { if (window.confirm(`Excluir o prospect "${p.nome}"?`)) agir(() => excluirProspect(p.id), () => navegar('/prospeccao')); }}>excluir</button>
        </div>
      </div>
      {erro && <p className="aviso aviso-erro">{erro}</p>}
      {p.estado === 'erro' && p.erro && <p className="aviso aviso-erro">{p.erro}</p>}
      {!ligado && <p className="aviso">A prospecção ainda não foi ligada no n8n (N8N_WEBHOOK_PROSPECT_*).</p>}

      <section className="bloco">
        <div className="bloco-topo"><h2>Dados do prospect</h2><button type="button" className="link" onClick={() => setEditando((v) => !v)}>{editando ? 'fechar' : 'editar'}</button></div>
        {editando ? (
          <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.target); agir(() => atualizarProspect(p.id, Object.fromEntries(f.entries())), () => { setEditando(false); return carregar(); }); }}>
            <div className="form-grade">
              <div className="form-campo"><label>Nome</label><input name="nome" defaultValue={p.nome} required /></div>
              <div className="form-campo"><label>Cidade</label><input name="cidade" defaultValue={p.cidade || ''} /></div>
              <div className="form-campo"><label>Setor</label><input name="setor" defaultValue={p.setor || ''} /></div>
              <div className="form-campo"><label>Instagram</label><input name="instagram" defaultValue={p.instagram || ''} /></div>
              <div className="form-campo"><label>Site</label><input name="site" defaultValue={p.site || ''} /></div>
            </div>
            <div className="acoes"><button type="submit" className="botao" disabled={ocupado}>Salvar</button></div>
          </form>
        ) : (
          <dl className="fatos">
            <div><dt>Ficha Google</dt><dd>{p.gmn ? (p.gmn.inexistente ? 'não tem' : `${p.gmn.nome}${p.gmn.endereco ? ` — ${p.gmn.endereco}` : ''}`) : 'não localizada ainda'}</dd></div>
            <div><dt>Instagram</dt><dd>{p.instagram ? `@${p.instagram}` : '—'}</dd></div>
            <div><dt>Site</dt><dd>{p.site || '—'}</dd></div>
          </dl>
        )}
        <div className="acoes">
          <button type="button" className="botao" disabled={ocupado || !ligado || p.estado === 'localizando' || p.estado === 'coletando'} onClick={() => agir(() => localizarProspect(p.id))}>
            {p.estado === 'localizando' || (ocupado && p.estado === 'novo') ? <><span className="girando" aria-hidden="true" /> Localizando…</> : (p.candidatos ? 'Localizar de novo' : 'Localizar no Google, Instagram e web')}
          </button>
          {p.gmn && p.estado !== 'coletando' && (
            <button type="button" className="botao botao-secundario" disabled={ocupado || !ligado} onClick={() => agir(() => coletarProspect(p.id))}>{d ? 'Coletar de novo' : 'Coletar dados'}</button>
          )}
        </div>
        {p.estado === 'coletando' && <p className="aviso" role="status"><span className="girando girando-mini" aria-hidden="true" /> Coletando ficha do Google, Instagram e site — 1 a 3 minutos.</p>}
      </section>

      {p.candidatos && !d && p.estado !== 'coletando' && (
        <section className="bloco"><Candidatos key={p.atualizado_em} p={p} ocupado={ocupado} aoConfirmar={(dados) => agir(async () => { await confirmarProspect(p.id, dados); return coletarProspect(p.id); })} /></section>
      )}

      {d && (
        <section className="bloco">
          <div className="bloco-topo"><h2>Scorecard</h2><span className="doc-data">coletado {fmtData(d.coletado_em)}</span></div>
          <div className="kpis">
            <div className={`kpi ${corNota(d.notas?.geral)}`}><span className="kpi-valor">{d.notas?.geral ?? '—'}</span><span className="kpi-rotulo">Geral</span></div>
            {PILARES.map(([k, r, peso]) => (
              <div key={k} className={`kpi ${corNota(d.notas?.[k])}`} title={d.notas?.[k] == null ? 'não foi possível medir este pilar' : ''}><span className="kpi-valor">{d.notas?.[k] ?? '—'}</span><span className="kpi-rotulo">{r} <span className="doc-data">{peso}%</span></span></div>
            ))}
          </div>
          {d.pilares_nao_medidos?.length > 0 && (
            <p className="form-ajuda">
              {d.pilares_nao_medidos.map((k) => PILARES.find((p) => p[0] === k)?.[1] || k).join(' e ')} {d.pilares_nao_medidos.length > 1 ? 'não puderam' : 'não pôde'} ser {d.pilares_nao_medidos.length > 1 ? 'medidos' : 'medido'} — {d.pilares_nao_medidos.length > 1 ? 'ficaram' : 'ficou'} fora da nota geral, que foi calculada só com os pilares avaliados.
            </p>
          )}
          {d.avisos?.length > 0 && <ul className="lista-simples">{d.avisos.map((a, i) => <li key={i} className="doc-data">{a}</li>)}</ul>}

          {d.potencial && (
            <div className="frente">
              <div className="bloco-topo"><h3>Potencial de oportunidade</h3><span className={`etiqueta ${d.potencial.nivel === 'alto' ? 'nota-boa' : d.potencial.nivel === 'medio' ? 'nota-media' : 'nota-ruim'}`}>{d.potencial.nivel}</span></div>
              <p>{d.potencial.leitura}</p>
              {d.potencial.ativos?.length > 0 && <p className="doc-data"><strong>Já tem:</strong> {d.potencial.ativos.join(' · ')}</p>}
              {d.potencial.lacunas?.length > 0 && <p className="doc-data"><strong>Falta:</strong> {d.potencial.lacunas.join(' · ')}</p>}
            </div>
          )}
          {d.gargalos?.length > 0 && (
            <div className="frente"><div className="bloco-topo"><h3>Onde mais dói hoje</h3></div>
              <ol className="lista-simples">{d.gargalos.map((g, i) => <li key={i}>{g}</li>)}</ol>
            </div>
          )}

          <Frente titulo="Google e SEO local" pilar="google" peso={20} nota={d.notas?.google} dados={d.google} achados={d.achados}>
            <TabelaBuscas buscas={d.google?.buscas} />
          </Frente>
          <Frente titulo="Reputação" pilar="reputacao" peso={15} nota={d.notas?.reputacao} dados={d.reputacao} achados={d.achados}>
            <Miudos titulo="Distribuição das notas" obj={d.reputacao?.distribuicao} />
            {d.reputacao?.palavras_dos_clientes?.length > 0 && <p className="doc-data"><strong>O que os clientes falam:</strong> {d.reputacao.palavras_dos_clientes.map((t) => `${t.palavra} (${t.mencoes})`).join(' · ')}</p>}
            {d.reputacao?.amostra_reclamacoes?.length > 0 && <ul className="lista-simples">{d.reputacao.amostra_reclamacoes.map((r, i) => <li key={i}>{r.estrelas}★ {r.texto} <span className="doc-data">({r.respondida ? 'respondida' : 'sem resposta'})</span></li>)}</ul>}
          </Frente>
          <Frente titulo="Instagram" pilar="instagram" peso={20} nota={d.notas?.instagram} dados={d.instagram} achados={d.achados} />
          <Frente titulo="Conteúdo" pilar="conteudo" peso={15} nota={d.notas?.conteudo} dados={d.conteudo} achados={d.achados}>
            <Miudos titulo="Formatos" obj={d.conteudo?.formatos} />
            <Miudos titulo="Temas nas legendas (nº de posts)" obj={d.conteudo?.temas_nas_legendas} />
          </Frente>
          <Frente titulo="Site" pilar="site" peso={15} nota={d.notas?.site} dados={d.site} achados={d.achados}>
            <Miudos titulo="Core Web Vitals" obj={d.site?.core_web_vitals} />
            <Miudos titulo="Páginas encontradas" obj={d.site?.estrutura} />
            <Miudos titulo="WhatsApp no site" obj={d.site?.whatsapp} />
          </Frente>
          <Frente titulo="Conversão e jornada" pilar="conversao" peso={10} nota={d.notas?.conversao} dados={{ existe: true, pontos_de_contato: (d.conversao?.pontos_de_contato || []).join(', ') || 'nenhum', faltando: (d.conversao?.faltando || []).join(', ') || '—' }} achados={d.achados}>
            {d.conversao?.etapas && (
              <div className="tabela-rolagem"><table className="tabela">
                <thead><tr><th>Etapa</th><th>Situação</th><th>O que foi visto</th></tr></thead>
                <tbody>{Object.entries(d.conversao.etapas).map(([k, e]) => (
                  <tr key={k} className={e.ok === false ? 'linha-detalhe' : ''}><td>{ETAPAS[k] || k}</td><td>{e.ok === true ? 'ok' : e.ok === false ? 'quebra' : 'não avaliada'}</td><td>{e.detalhe}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Frente>
          <Frente titulo="Concorrência" pilar="concorrencia" peso={5} nota={d.notas?.concorrencia} dados={d.concorrencia && { existe: true, total_identificados: d.concorrencia.total_identificados, mediana_nota: d.concorrencia.mediana_nota, mediana_avaliacoes: d.concorrencia.mediana_avaliacoes }} achados={d.achados}>
            {d.concorrencia?.principais?.length > 0 && (
              <div className="tabela-rolagem"><table className="tabela">
                <thead><tr><th>Concorrente</th><th>Nota</th><th>Avaliações</th><th>Site</th><th>Apareceu na busca</th></tr></thead>
                <tbody>{d.concorrencia.principais.map((c, i) => <tr key={i}><td>{c.nome}</td><td>{c.nota ?? '—'}</td><td>{c.avaliacoes ?? '—'}</td><td>{c.site ? 'sim' : 'não'}</td><td>{c.busca}</td></tr>)}</tbody>
              </table></div>
            )}
          </Frente>
          <div className="acoes">
            <button type="button" className="botao" disabled={ocupado || !ligado || (p.documentos || []).some((x) => x.estado === 'gerando')} onClick={() => agir(() => gerarDiagnostico(p.id))}>Gerar diagnóstico (PDF)</button>
          </div>
          {(p.documentos || []).length > 0 && (
            <ul className="lista-anexos">
              {p.documentos.map((doc) => (
                <li key={doc.id} className="anexo">
                  <div className="doc-info"><span className="doc-tipo">Diagnóstico de presença digital</span><span className="doc-data">{fmtData(doc.criado_em)}</span></div>
                  <div className="doc-acoes">
                    {doc.estado === 'gerando' && <span className="etiqueta etiqueta-ok"><span className="girando girando-mini" aria-hidden="true" /> gerando</span>}
                    {doc.estado === 'erro' && <span className="etiqueta etiqueta-erro" title={doc.erro || ''}>falhou</span>}
                    {doc.estado === 'ok' && <a className="link" href={urlDownload(doc)}>Baixar PDF</a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!d && p.gmn && p.estado === 'localizado' && <p className="form-ajuda">Localização confirmada. Clique em "Coletar dados" para montar o scorecard.</p>}
      <p className="doc-data">Última atividade: {fmtDia(p.atualizado_em)}</p>
    </>
  );
}
