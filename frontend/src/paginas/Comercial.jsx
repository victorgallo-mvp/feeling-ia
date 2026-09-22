import { useEffect, useRef, useState } from 'react';
import { classificarComercial, lerComercial } from '../api.js';

const ETAPA = {
  novo: 'Novo', em_conversa: 'Em conversa', qualificado: 'Qualificado', simulacao_enviada: 'Simulação enviada',
  agendou: 'Agendou', comprou: 'Comprou', perdido: 'Perdido', esfriou: 'Esfriou',
};
const OPERACAO = { a_vista: 'à vista', financiamento: 'financiamento', consorcio: 'consórcio', nao_definido: '' };
const FUNIL = ['novo', 'em_conversa', 'qualificado', 'simulacao_enviada', 'agendou', 'comprou'];

const fmtMin = (m) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`);
const fmtData = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

// Aba "Comercial": lê a tabela leads_comercial (preenchida pelo n8n) e desenha KPIs, funil, alertas e leads.
export default function Comercial({ clienteId }) {
  const [dias, setDias] = useState(7);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [filtroEtapa, setFiltroEtapa] = useState('todas');
  const [aberto, setAberto] = useState(null);
  const [pedindo, setPedindo] = useState(false);
  const timer = useRef(null);

  const carregar = () => lerComercial(clienteId, dias).then((d) => { setDados(d); setErro(''); }).catch((e) => setErro(e.message));
  useEffect(() => { setDados(null); carregar(); }, [clienteId, dias]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (dados && dados.ativo === false) return null; // cliente sem WhatsApp ligado ao cockpit
  if (!dados) return <section className="bloco"><h2>Comercial (WhatsApp)</h2>{erro ? <p className="aviso aviso-erro">{erro}</p> : <p className="vazio">Carregando…</p>}</section>;

  const k = dados.kpis;
  const meta = c.meta?.[dias === 7 ? 'd7' : 'd30'];
  const leads = filtroEtapa === 'todas' ? dados.leads : dados.leads.filter((l) => (l.etapa || 'sem') === filtroEtapa);
  const totalFunil = Math.max(1, ...FUNIL.map((e) => dados.funil[e] || 0));

  return (
    <section className="bloco">
      <div className="bloco-topo">
        <h2>Comercial (WhatsApp)</h2>
        <div className="doc-acoes">
          <select aria-label="período" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={7}>últimos 7 dias</option>
            <option value={30}>últimos 30 dias</option>
            <option value={90}>últimos 90 dias</option>
          </select>
          <button type="button" className="botao botao-secundario" disabled={pedindo || emAndamento} onClick={classificar}>
            {emAndamento ? <><span className="girando girando-mini" aria-hidden="true" /> Classificando…</> : 'Atualizar conversas'}
          </button>
        </div>
      </div>
      <p className="doc-data">
        {c.concluido_em ? `Última atualização ${fmtData(c.concluido_em)} · ${c.total ?? 0} leads lidos, ${c.classificados ?? 0} classificados nesta rodada` : 'Ainda não classificado — clique em "Atualizar conversas".'}
        {c.erro ? ` · erro: ${c.erro}` : ''}
        {k.sem_classificar > 0 ? ` · ${k.sem_classificar} sem classificação (próxima rodada)` : ''}
      </p>
      {erro && <p className="aviso aviso-erro">{erro}</p>}

      <div className="kpis">
        <div className="kpi"><span className="kpi-valor">{k.leads}</span><span className="kpi-rotulo">leads</span></div>
        <div className="kpi"><span className="kpi-valor">{k.de_anuncio}</span><span className="kpi-rotulo">de anúncio (piso)</span></div>
        <div className="kpi"><span className="kpi-valor">{k.pct_responderam == null ? '—' : `${k.pct_responderam}%`}</span><span className="kpi-rotulo">voltaram a responder</span></div>
        <div className="kpi"><span className="kpi-valor">{fmtMin(k.tempo_medio_resposta_humana_min)}</span><span className="kpi-rotulo">1ª resposta humana (média)</span></div>
        <div className="kpi"><span className="kpi-valor">{k.avancaram}</span><span className="kpi-rotulo">avançaram no funil</span></div>
        <div className="kpi"><span className="kpi-valor">{k.nota_media_atendimento ?? '—'}</span><span className="kpi-rotulo">nota do atendimento (1–5)</span></div>
      </div>

      {(meta || dias === 90) && (
        <p className="form-ajuda">
          {meta
            ? `Conciliação com o Meta (coleta ${meta.coleta}): ${meta.conversas_meta ?? '—'} conversas iniciadas e ${meta.leads_meta ?? '—'} leads segundo os anúncios, contra ${k.leads} leads reais no WhatsApp (${k.de_anuncio} com marca de anúncio). Diferença de 10–25% é normal; acima disso vale investigar.`
            : 'Conciliação com o Meta disponível nos períodos de 7 e 30 dias.'}
        </p>
      )}

      <div className="funil">
        {FUNIL.map((e) => (
          <div key={e} className="funil-linha">
            <span className="funil-rotulo">{ETAPA[e]}</span>
            <span className="funil-barra"><span style={{ width: `${(100 * (dados.funil[e] || 0)) / totalFunil}%` }} /></span>
            <span className="funil-qtd">{dados.funil[e] || 0}</span>
          </div>
        ))}
        <p className="doc-data">Perdidos: {dados.funil.perdido || 0} · Esfriaram: {dados.funil.esfriou || 0}</p>
      </div>

      {dados.alertas.length > 0 && (
        <>
          <h3>Alertas</h3>
          <ul className="lista-simples">
            {dados.alertas.map((a, i) => (
              <li key={i} className="texto-erro">
                {a.tipo === 'sem_resposta'
                  ? `${a.nome || a.contato} espera resposta há ${a.horas} h${a.etapa ? ` (${ETAPA[a.etapa] || a.etapa})` : ''}`
                  : `${a.nome || a.contato} está qualificado${a.interesse ? ` (${a.interesse})` : ''} e nunca falou com um atendente`}
              </li>
            ))}
          </ul>
        </>
      )}

      {(dados.interesses.length > 0 || dados.objecoes.length > 0) && (
        <div className="form-grade">
          <div className="form-campo">
            <h3>Interesses mais citados</h3>
            <ul className="lista-simples">{dados.interesses.map((x) => <li key={x.valor}>{x.valor} <span className="doc-data">({x.qtd})</span></li>)}</ul>
          </div>
          <div className="form-campo">
            <h3>Objeções mais frequentes</h3>
            {dados.objecoes.length ? <ul className="lista-simples">{dados.objecoes.map((x) => <li key={x.valor}>{x.valor} <span className="doc-data">({x.qtd})</span></li>)}</ul> : <p className="vazio">nenhuma registrada</p>}
          </div>
        </div>
      )}

      <div className="bloco-topo">
        <h3>Leads ({leads.length})</h3>
        <select aria-label="filtrar por etapa" value={filtroEtapa} onChange={(e) => setFiltroEtapa(e.target.value)}>
          <option value="todas">todas as etapas</option>
          {Object.entries(ETAPA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          <option value="sem">sem classificação</option>
        </select>
      </div>
      {leads.length === 0 ? <p className="vazio">Nenhum lead no período.</p> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Lead</th><th>Origem</th><th>Interesse</th><th>Etapa</th><th>1ª resp. humana</th><th>Espera</th><th>Nota</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <>
                  <tr key={l.contato} className="linha-clicavel" onClick={() => setAberto(aberto === l.contato ? null : l.contato)}>
                    <td>{l.nome || l.contato}<div className="doc-data">{fmtData(l.primeiro_contato)}</div></td>
                    <td>{l.origem === 'anuncio' ? 'anúncio' : 'orgânico'}</td>
                    <td>{l.interesse || '—'}{l.operacao && OPERACAO[l.operacao] ? <div className="doc-data">{OPERACAO[l.operacao]}</div> : null}</td>
                    <td>{l.etapa ? ETAPA[l.etapa] : <span className="doc-data">sem classificação</span>}</td>
                    <td>{l.msgs_humano ? fmtMin(l.primeira_resposta_humana_seg == null ? null : Math.round(l.primeira_resposta_humana_seg / 60)) : <span className="doc-data">só IA</span>}</td>
                    <td className={l.aguardando_resposta_h >= 2 ? 'texto-erro' : ''}>{l.aguardando_resposta_h != null ? `${l.aguardando_resposta_h} h` : '—'}</td>
                    <td>{l.nota_atendimento ?? '—'}</td>
                  </tr>
                  {aberto === l.contato && (
                    <tr key={`${l.contato}-d`} className="linha-detalhe">
                      <td colSpan={7}>
                        {l.resumo && <p><strong>Resumo:</strong> {l.resumo}</p>}
                        {l.proximo_passo && <p><strong>Próximo passo:</strong> {l.proximo_passo}</p>}
                        {l.objecao && <p><strong>Objeção:</strong> {l.objecao}</p>}
                        {l.motivo_nota && <p><strong>Atendimento:</strong> {l.motivo_nota}</p>}
                        {l.anuncio && <p className="doc-data">Anúncio: {String(l.anuncio).slice(0, 160)}</p>}
                        <p className="doc-data">Mensagens: lead {l.msgs_lead} · IA {l.msgs_ia} · humano {l.msgs_humano} · última {fmtData(l.ultima_msg)} ({l.ultima_msg_de || '—'})</p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
