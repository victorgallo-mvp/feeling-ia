import { useEffect, useRef, useState } from 'react';
import { classificarComercial, gerarAuditoria, lerComercial } from '../api.js';

const ETAPA = {
  novo: 'Novo', em_conversa: 'Em conversa', qualificado: 'Qualificado', simulacao_enviada: 'Simulação enviada',
  agendou: 'Agendou', comprou: 'Comprou', perdido: 'Perdido', esfriou: 'Esfriou',
};
const OPERACAO = { a_vista: 'à vista', financiamento: 'financiamento', consorcio: 'consórcio', nao_definido: '' };
const FUNIL = ['novo', 'em_conversa', 'qualificado', 'simulacao_enviada', 'agendou', 'comprou'];
const PERIODOS = [['semana', 'Semana passada (seg–dom)'], ['7d', 'Últimos 7 dias'], ['mes', 'Mês passado'], ['30d', 'Últimos 30 dias']];

const fmtMin = (m) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`);
const fmtData = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDia = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
// Texto do anúncio vem cru do Meta (emojis, quebras); reduz a um rótulo curto e estável.
const rotuloAnuncio = (t) => {
  const limpo = String(t || '').replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim();
  return limpo ? (limpo.length > 60 ? `${limpo.slice(0, 57)}…` : limpo) : 'anúncio sem texto';
};

function Kpis({ r, foco }) {
  return (
    <div className="kpis">
      <div className="kpi"><span className="kpi-valor">{r.leads}</span><span className="kpi-rotulo">leads</span></div>
      <div className="kpi"><span className="kpi-valor">{r.pct_responderam == null ? '—' : `${r.pct_responderam}%`}</span><span className="kpi-rotulo">voltaram a responder</span></div>
      <div className="kpi"><span className="kpi-valor">{fmtMin(r.tempo_medio_resposta_humana_min)}</span><span className="kpi-rotulo">até o 1º atendente (mediana, h. úteis)</span></div>
      <div className="kpi"><span className="kpi-valor">{r.qualificados}</span><span className="kpi-rotulo">qualificados ou além</span></div>
      <div className="kpi"><span className="kpi-valor">{r.agendaram}</span><span className="kpi-rotulo">agendaram / compraram</span></div>
      <div className="kpi"><span className="kpi-valor">{r.compraram}</span><span className="kpi-rotulo">compraram</span></div>
      <div className={`kpi${r.esperando ? ' kpi-alerta' : ''}`}><span className="kpi-valor">{r.esperando}</span><span className="kpi-rotulo">esperando resposta (≥ 2 h úteis)</span></div>
      <div className="kpi"><span className="kpi-valor">{r.nota_media ?? '—'}</span><span className="kpi-rotulo">nota do atendimento (1–5)</span></div>
      {foco && <div className="kpi"><span className="kpi-valor">{r.esfriaram}</span><span className="kpi-rotulo">esfriaram</span></div>}
    </div>
  );
}

function Funil({ funil }) {
  const total = Math.max(1, ...FUNIL.map((e) => funil[e] || 0));
  return (
    <div className="funil">
      {FUNIL.map((e) => (
        <div key={e} className="funil-linha">
          <span className="funil-rotulo">{ETAPA[e]}</span>
          <span className="funil-barra"><span style={{ width: `${(100 * (funil[e] || 0)) / total}%` }} /></span>
          <span className="funil-qtd">{funil[e] || 0}</span>
        </div>
      ))}
      <p className="doc-data">Perdidos: {funil.perdido || 0} · Esfriaram: {funil.esfriou || 0}</p>
    </div>
  );
}

function Listas({ r }) {
  if (!r.interesses.length && !r.objecoes.length) return null;
  return (
    <div className="form-grade">
      <div className="form-campo">
        <h4>Interesses</h4>
        <ul className="lista-simples">{r.interesses.map((x) => <li key={x.valor}>{x.valor} <span className="doc-data">({x.qtd})</span></li>)}</ul>
      </div>
      <div className="form-campo">
        <h4>Objeções</h4>
        {r.objecoes.length ? <ul className="lista-simples">{r.objecoes.map((x) => <li key={x.valor}>{x.valor} <span className="doc-data">({x.qtd})</span></li>)}</ul> : <p className="vazio">nenhuma registrada</p>}
      </div>
    </div>
  );
}

function Auditoria({ a }) {
  if (!a || !a.avaliadas) return null;
  const grupos = [];
  for (const c of a.criterios) {
    const g = grupos.find((x) => x.nome === c.grupo);
    if (g) g.itens.push(c); else grupos.push({ nome: c.grupo, itens: [c] });
  }
  const cor = (c) => (c.pct == null ? '' : c.ruim ? (c.pct >= 30 ? 'texto-erro' : '') : c.pct >= 70 ? 'nota-boa' : c.pct >= 40 ? 'nota-media' : 'nota-ruim');
  return (
    <>
      <h4>Auditoria do atendimento (padrão Feeling)</h4>
      <p className="form-ajuda">Percentual das {a.avaliadas} conversas classificadas que cumpriram cada critério do modelo de auditoria da casa. Itens marcados como problema aparecem em vermelho quando passam de 30%.</p>
      <div className="tabela-rolagem">
        <table className="tabela">
          <thead><tr><th>Critério</th><th>Conversas</th><th>%</th></tr></thead>
          <tbody>
            {grupos.map((g) => (
              <>
                <tr key={g.nome} className="linha-detalhe"><td colSpan={3}><strong>{g.nome}</strong></td></tr>
                {g.itens.map((c) => (
                  <tr key={c.chave}>
                    <td>{c.rotulo}{c.ruim ? ' (problema)' : ''}</td>
                    <td>{c.sim} de {c.avaliadas}</td>
                    <td className={cor(c)}>{c.pct == null ? '—' : `${c.pct}%`}</td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
      {a.falhas.length > 0 && (
        <>
          <h4>Falhas mais repetidas</h4>
          <ul className="lista-simples">{a.falhas.map((f, i) => <li key={i}>{f.texto} <span className="doc-data">({f.qtd}x)</span></li>)}</ul>
        </>
      )}
    </>
  );
}

function TabelaLeads({ leads, mostrarAnuncio }) {
  const [aberto, setAberto] = useState(null);
  if (!leads.length) return <p className="vazio">Nenhum lead neste recorte.</p>;
  return (
    <div className="tabela-rolagem">
      <table className="tabela">
        <thead><tr><th>Lead</th>{mostrarAnuncio && <th>Anúncio</th>}<th>Interesse</th><th>Etapa</th><th>1º atendente (h. úteis)</th><th>Espera (h. úteis)</th><th>Nota</th></tr></thead>
        <tbody>
          {leads.map((l) => (
            <>
              <tr key={l.contato} className="linha-clicavel" onClick={() => setAberto(aberto === l.contato ? null : l.contato)}>
                <td>{l.nome || l.contato}<div className="doc-data">{fmtData(l.primeiro_contato)}</div></td>
                {mostrarAnuncio && <td className="celula-anuncio">{rotuloAnuncio(l.anuncio)}</td>}
                <td>{l.interesse || '—'}{l.operacao && OPERACAO[l.operacao] ? <div className="doc-data">{OPERACAO[l.operacao]}</div> : null}</td>
                <td>{l.etapa ? ETAPA[l.etapa] : <span className="doc-data">sem classificação</span>}</td>
                <td>{l.msgs_humano ? fmtMin(l.primeira_resposta_humana_seg == null ? null : Math.round(l.primeira_resposta_humana_seg / 60)) : <span className="doc-data">só IA</span>}</td>
                <td className={l.aguardando_resposta_h >= 2 ? 'texto-erro' : ''}>{l.aguardando_resposta_h != null ? `${l.aguardando_resposta_h} h` : '—'}</td>
                <td>{l.nota_atendimento ?? '—'}</td>
              </tr>
              {aberto === l.contato && (
                <tr key={`${l.contato}-d`} className="linha-detalhe">
                  <td colSpan={mostrarAnuncio ? 7 : 6}>
                    {l.resumo && <p><strong>Resumo:</strong> {l.resumo}</p>}
                    {l.proximo_passo && <p><strong>Próximo passo:</strong> {l.proximo_passo}</p>}
                    {l.objecao && <p><strong>Objeção:</strong> {l.objecao}</p>}
                    {l.motivo_nota && <p><strong>Atendimento:</strong> {l.motivo_nota}</p>}
                    {(l.falhas || []).length > 0 && <p><strong>Falhas:</strong> {l.falhas.join(' · ')}</p>}
                    {l.anuncio && <p className="doc-data">Anúncio: {String(l.anuncio).replace(/\s+/g, ' ').slice(0, 200)}</p>}
                    <p className="doc-data">Mensagens: lead {l.msgs_lead} · IA {l.msgs_ia} · humano {l.msgs_humano} · última {fmtData(l.ultima_msg)} ({l.ultima_msg_de || '—'})</p>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Seção "Comercial (WhatsApp)": anúncio primeiro (é o que a Feeling entrega), orgânico depois, compacto.
export default function Comercial({ clienteId, aoNovoDocumento }) {
  const [periodo, setPeriodo] = useState('semana');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [filtroEtapa, setFiltroEtapa] = useState('todas');
  const [verOrganico, setVerOrganico] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const timer = useRef(null);

  const carregar = () => lerComercial(clienteId, periodo).then((d) => { setDados(d); setErro(''); }).catch((e) => setErro(e.message));
  useEffect(() => { setDados(null); carregar(); }, [clienteId, periodo]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = dados?.classificacao || {};
  const emAndamento = c.iniciado_em && !c.concluido_em && Date.now() - new Date(c.iniciado_em).getTime() < 15 * 60 * 1000;
  useEffect(() => {
    clearInterval(timer.current);
    if (emAndamento) timer.current = setInterval(carregar, 6000);
    return () => clearInterval(timer.current);
  }, [emAndamento]); // eslint-disable-line react-hooks/exhaustive-deps

  async function classificar() {
    setPedindo(true);
    try { await classificarComercial(clienteId); await carregar(); } catch (e) { setErro(e.message); } finally { setPedindo(false); }
  }

  async function auditar() {
    setPedindo(true); setErro('');
    try { await gerarAuditoria(clienteId, periodo); aoNovoDocumento?.(); } catch (e) { setErro(e.message); } finally { setPedindo(false); }
  }

  if (dados && dados.ativo === false) return null;
  if (!dados) return <section className="bloco"><h2>Comercial (WhatsApp)</h2>{erro ? <p className="aviso aviso-erro">{erro}</p> : <p className="vazio">Carregando…</p>}</section>;

  const a = dados.anuncio, o = dados.organico;
  const meta = c.meta?.[periodo === '30d' || periodo === 'mes' ? 'd30' : 'd7'];
  const filtrar = (ls) => (filtroEtapa === 'todas' ? ls : ls.filter((l) => (l.etapa || 'sem') === filtroEtapa));
  const leadsAnuncio = filtrar(dados.leads.filter((l) => l.origem === 'anuncio'));
  const leadsOrganico = filtrar(dados.leads.filter((l) => l.origem !== 'anuncio'));
  const alertasAnuncio = dados.alertas.filter((x) => x.origem === 'anuncio');
  const alertasOrganico = dados.alertas.filter((x) => x.origem !== 'anuncio');

  return (
    <section className="bloco">
      <div className="bloco-topo">
        <h2>Comercial (WhatsApp)</h2>
        <div className="doc-acoes">
          <select aria-label="período" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          <button type="button" className="botao botao-secundario" disabled={pedindo || emAndamento} onClick={classificar}>
            {emAndamento ? <><span className="girando girando-mini" aria-hidden="true" /> Classificando…</> : 'Atualizar conversas'}
          </button>
          <button type="button" className="botao" disabled={pedindo || emAndamento || !dados?.auditoria?.avaliadas} onClick={auditar} title="Gera o PDF no modelo de auditoria da casa">Gerar auditoria (PDF)</button>
        </div>
      </div>
      <p className="doc-data">
        {fmtDia(dados.periodo.ini)} a {fmtDia(new Date(new Date(`${dados.periodo.fim}T12:00:00`).getTime() - 86400000).toISOString().slice(0, 10))} · {dados.todos.leads} leads no total ({a.leads} de anúncio, {o.leads} orgânicos)
        {c.concluido_em ? ` · classificação de ${fmtData(c.concluido_em)}` : ' · ainda não classificado'}
        {c.erro ? ` · erro: ${c.erro}` : ''}
        {dados.todos.sem_classificar > 0 ? ` · ${dados.todos.sem_classificar} sem classificação` : ''}
      </p>
      {erro && <p className="aviso aviso-erro">{erro}</p>}

      <h3 className="titulo-foco">Leads de anúncio</h3>
      <p className="form-ajuda">Quem chegou clicando num anúncio (marca do Meta na primeira mensagem). É o piso: quem veio por link, QR ou número salvo não leva a marca. Tempos contam só horário comercial (seg–sex 8–18, sáb 8–12).{meta ? ` Meta contou ${meta.conversas_meta ?? '—'} conversas iniciadas no mesmo recorte.` : ''}</p>
      <Kpis r={a} foco />

      {dados.por_anuncio.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Anúncio</th><th>Leads</th><th>Responderam</th><th>Qualif.+</th><th>Agend./Compra</th><th>1º atendente (mediana)</th><th>Esperando</th><th>Nota</th></tr></thead>
            <tbody>
              {dados.por_anuncio.map((x) => (
                <tr key={x.anuncio}>
                  <td className="celula-anuncio">{rotuloAnuncio(x.anuncio)}</td>
                  <td>{x.leads}</td><td>{x.responderam}</td><td>{x.qualificados}</td><td>{x.agendaram}</td>
                  <td>{fmtMin(x.tempo_medio_resposta_humana_min)}</td>
                  <td className={x.esperando ? 'texto-erro' : ''}>{x.esperando}</td>
                  <td>{x.nota_media ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {alertasAnuncio.length > 0 && (
        <>
          <h4>Precisa de ação agora</h4>
          <ul className="lista-simples">
            {alertasAnuncio.map((x, i) => (
              <li key={i} className="texto-erro">
                {x.tipo === 'sem_resposta'
                  ? `${x.nome || x.contato} (${x.interesse || 'interesse não definido'}) espera resposta há ${x.horas} h úteis${x.etapa ? ` — ${ETAPA[x.etapa] || x.etapa}` : ''}`
                  : `${x.nome || x.contato} está qualificado${x.interesse ? ` (${x.interesse})` : ''} e nunca falou com um atendente`}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="form-grade">
        <div className="form-campo"><h4>Funil dos leads de anúncio</h4><Funil funil={a.funil} /></div>
        <div className="form-campo"><Listas r={a} /></div>
      </div>

      <Auditoria a={dados.auditoria} />

      <div className="bloco-topo">
        <h4>Leads de anúncio ({leadsAnuncio.length})</h4>
        <select aria-label="filtrar por etapa" value={filtroEtapa} onChange={(e) => setFiltroEtapa(e.target.value)}>
          <option value="todas">todas as etapas</option>
          {Object.entries(ETAPA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          <option value="sem">sem classificação</option>
        </select>
      </div>
      <TabelaLeads leads={leadsAnuncio} mostrarAnuncio />

      <div className="bloco-topo organico-topo">
        <h3>Orgânico e outros canais</h3>
        <button type="button" className="link" onClick={() => setVerOrganico((v) => !v)}>{verOrganico ? 'recolher' : `ver ${o.leads} leads`}</button>
      </div>
      <p className="form-ajuda">Perfil do Instagram, indicação, clientes antigos, pós-venda. Mede o atendimento, não a mídia.</p>
      <Kpis r={o} />
      {alertasOrganico.length > 0 && (
        <p className="doc-data">{alertasOrganico.length} lead{alertasOrganico.length > 1 ? 's' : ''} orgânico{alertasOrganico.length > 1 ? 's' : ''} esperando resposta ou sem atendente — abra a lista para ver.</p>
      )}
      {verOrganico && (
        <>
          <div className="form-grade">
            <div className="form-campo"><h4>Funil</h4><Funil funil={o.funil} /></div>
            <div className="form-campo"><Listas r={o} /></div>
          </div>
          {alertasOrganico.length > 0 && (
            <ul className="lista-simples">
              {alertasOrganico.map((x, i) => (
                <li key={i} className="texto-erro">
                  {x.tipo === 'sem_resposta'
                    ? `${x.nome || x.contato} (${x.interesse || 'interesse não definido'}) espera resposta há ${x.horas} h úteis`
                    : `${x.nome || x.contato} está qualificado e nunca falou com um atendente`}
                </li>
              ))}
            </ul>
          )}
          <TabelaLeads leads={leadsOrganico} />
        </>
      )}
    </section>
  );
}
