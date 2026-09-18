import { useMemo, useRef, useState } from 'react';
import { atualizarCliente, enviarReuniao, registrarSugestoes, urlDownload, urlTranscricao } from '../api.js';

const EXTENSOES = ['.txt', '.md', '.docx', '.pdf'];
const CAMPOS = { setor: 'Setor', cidade: 'Cidade', site: 'Site', instagram: 'Instagram', abrangencia: 'Abrangência' };

// Sugestões de uma reunião viram uma lista plana de itens marcáveis.
function itensDe(doc) {
  const s = doc?.sugestoes;
  if (!s) return [];
  const itens = [];
  for (const k of Object.keys(CAMPOS)) if (s[k]) itens.push({ chave: k, rotulo: CAMPOS[k], valor: s[k], grupo: 'cadastro' });
  (s.perfil_adicoes || []).forEach((v, i) => itens.push({ chave: `perfil:${i}`, rotulo: 'Perfil', valor: v, grupo: 'perfil' }));
  (s.orientacoes_adicoes || []).forEach((v, i) => itens.push({ chave: `orientacoes:${i}`, rotulo: 'Orientações', valor: v, grupo: 'orientacoes' }));
  return itens;
}

// Seção "Reuniões": upload da transcrição + sugestões de cadastro da última reunião pendente.
export default function Reunioes({ clienteId, cliente, documentos, ligado, aoNovoDocumento, aoAtualizarDocumento, aoAtualizarCliente }) {
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState('');
  const [estado, setEstado] = useState({ fase: 'parado', mensagem: '' }); // parado | enviando | ok | erro
  const [marcados, setMarcados] = useState(null); // Set de chaves; null = tudo marcado
  const [aplicando, setAplicando] = useState(false);
  const inputRef = useRef(null);

  // última reunião com sugestões ainda não tratadas
  const pendente = useMemo(() => {
    for (const d of documentos) {
      if (d.tipo !== 'reuniao' || !d.sugestoes) continue;
      const itens = itensDe(d);
      const feitas = new Set(d.aplicadas || []);
      const restantes = itens.filter((i) => !feitas.has(i.chave));
      if (restantes.length) return { doc: d, itens: restantes };
    }
    return null;
  }, [documentos]);

  const selecionados = (chave) => (marcados ? marcados.has(chave) : true);
  const alternar = (chave) => setMarcados((m) => {
    const base = new Set(m ?? pendente.itens.map((i) => i.chave));
    base.has(chave) ? base.delete(chave) : base.add(chave);
    return base;
  });

  async function enviar(arquivo) {
    if (!arquivo || estado.fase === 'enviando') return;
    const ext = arquivo.name.slice(arquivo.name.lastIndexOf('.')).toLowerCase();
    if (!EXTENSOES.includes(ext)) { setEstado({ fase: 'erro', mensagem: `"${arquivo.name}" não é aceito. Envie TXT, MD, DOCX ou PDF.` }); return; }
    setEstado({ fase: 'enviando', mensagem: `Lendo "${arquivo.name}" e montando o resumo — leva de 20s a 1 minuto.` });
    try {
      const r = await enviarReuniao(clienteId, arquivo, { titulo, data_reuniao: data });
      aoNovoDocumento({ ...r.documento, sugestoes: r.sugestoes, aplicadas: [] });
      setMarcados(null);
      setTitulo(''); setData('');
      setEstado({ fase: 'ok', mensagem: r.indexado
        ? 'Resumo salvo e adicionado ao cérebro. Confira as sugestões de cadastro abaixo.'
        : 'Resumo salvo, mas não entrou no cérebro (o n8n de anexar não respondeu). Você pode anexar o PDF manualmente.' });
    } catch (e) {
      setEstado({ fase: 'erro', mensagem: `Não deu para resumir: ${e.message}` });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function aplicar() {
    if (!pendente) return;
    const escolhidos = pendente.itens.filter((i) => selecionados(i.chave));
    if (!escolhidos.length) return;
    setAplicando(true);
    try {
      const dados = {
        nome: cliente.nome, setor: cliente.setor, cidade: cliente.cidade, conta_id: cliente.conta_id, instagram: cliente.instagram,
        site: cliente.site, google_ads_id: cliente.google_ads_id, abrangencia: cliente.abrangencia,
        perfil: cliente.perfil || '', orientacoes: cliente.orientacoes || '',
      };
      for (const i of escolhidos) {
        if (i.grupo === 'cadastro') dados[i.chave] = i.valor;
        else if (i.grupo === 'perfil') dados.perfil = `${dados.perfil.trimEnd()}\n${i.valor}`.trim();
        else dados.orientacoes = `${dados.orientacoes.trimEnd()}\n${i.valor}`.trim();
      }
      if (dados.orientacoes.length > 1500) throw new Error('as orientações passariam de 1.500 caracteres — edite a ficha e enxugue antes');
      const atualizado = await atualizarCliente(clienteId, dados);
      aoAtualizarCliente(atualizado);
      const aplicadas = [...(pendente.doc.aplicadas || []), ...escolhidos.map((i) => i.chave)];
      await registrarSugestoes(pendente.doc.id, { aplicadas });
      aoAtualizarDocumento({ ...pendente.doc, aplicadas });
      setMarcados(null);
    } catch (e) {
      window.alert(`Não deu para aplicar: ${e.message}`);
    } finally {
      setAplicando(false);
    }
  }

  async function descartar() {
    if (!pendente || !window.confirm('Descartar as sugestões desta reunião? O resumo continua salvo.')) return;
    try {
      await registrarSugestoes(pendente.doc.id, { descartar: true });
      aoAtualizarDocumento({ ...pendente.doc, sugestoes: null, aplicadas: [] });
      setMarcados(null);
    } catch (e) {
      window.alert(`Não deu para descartar: ${e.message}`);
    }
  }

  const enviando = estado.fase === 'enviando';

  return (
    <section className="bloco">
      <h2>Reuniões</h2>
      <p className="vazio">Suba a transcrição de uma reunião com o cliente. A IA monta o resumo (decisões, pendências, objeções, orientações), guarda como documento e leva só o resumo para o cérebro. A transcrição bruta fica salva, mas fora da busca.</p>

      {!ligado ? (
        <p className="aviso">O resumo de reuniões ainda não foi ligado no n8n (variável N8N_WEBHOOK_REUNIAO).</p>
      ) : (
        <>
          <div className="form-grade reuniao-campos">
            <div className="form-campo">
              <label htmlFor="reuniao-titulo">Assunto (opcional)</label>
              <input id="reuniao-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="ex.: Alinhamento da campanha de outubro" disabled={enviando} />
            </div>
            <div className="form-campo">
              <label htmlFor="reuniao-data">Data da reunião (opcional)</label>
              <input id="reuniao-data" value={data} onChange={(e) => setData(e.target.value)} placeholder="ex.: 16/09/2026" disabled={enviando} />
            </div>
          </div>
          <label className={`upload${enviando ? ' upload-ocupado' : ''}`}>
            <input ref={inputRef} type="file" className="upload-input" accept={EXTENSOES.join(',')} disabled={enviando} onChange={(e) => enviar(e.target.files?.[0])} />
            {enviando ? <><span className="girando" aria-hidden="true" /> Resumindo…</> : <span><strong>Escolha a transcrição</strong> · TXT, MD, DOCX ou PDF</span>}
          </label>
          {estado.mensagem && <p className={`aviso${estado.fase === 'erro' ? ' aviso-erro' : ''}`} role={estado.fase === 'erro' ? 'alert' : 'status'}>{estado.mensagem}</p>}
        </>
      )}

      {pendente && (
        <div className="sugestoes">
          <div className="bloco-topo">
            <h3>Sugestões para o cadastro</h3>
            <span className="doc-data">da reunião "{pendente.doc.titulo || 'sem assunto'}"{pendente.doc.data_reuniao ? ` · ${pendente.doc.data_reuniao}` : ''}</span>
          </div>
          {pendente.doc.sugestoes?.resumo_curto && <p className="sugestoes-resumo">{pendente.doc.sugestoes.resumo_curto}</p>}
          <ul className="lista-sugestoes">
            {pendente.itens.map((i) => (
              <li key={i.chave}>
                <label className="sugestao">
                  <input type="checkbox" checked={selecionados(i.chave)} onChange={() => alternar(i.chave)} disabled={aplicando} />
                  <span className="sugestao-rotulo">{i.rotulo}</span>
                  <span className="sugestao-valor">{i.valor}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="acoes">
            <button type="button" className="botao" disabled={aplicando || !pendente.itens.some((i) => selecionados(i.chave))} onClick={aplicar}>
              {aplicando ? 'Aplicando…' : 'Aplicar selecionadas ao cadastro'}
            </button>
            <button type="button" className="botao botao-secundario" disabled={aplicando} onClick={descartar}>Descartar</button>
          </div>
          <p className="form-ajuda">Setor, cidade, site, Instagram e abrangência substituem o valor atual; perfil e orientações recebem as linhas novas no fim. Nada muda sem clicar em aplicar.</p>
        </div>
      )}

      {documentos.some((d) => d.tipo === 'reuniao') && (
        <ul className="lista-anexos">
          {documentos.filter((d) => d.tipo === 'reuniao').map((d) => (
            <li key={d.id} className="anexo">
              <div className="doc-info">
                <span className="doc-tipo">{d.titulo || 'Reunião'}</span>
                <span className="doc-data">{d.data_reuniao ? `reunião de ${d.data_reuniao} · ` : ''}resumo salvo em {new Date(d.criado_em).toLocaleDateString('pt-BR')}</span>
              </div>
              <div className="doc-acoes">
                {d.estado !== 'perdido' && <a className="link" href={urlDownload(d)}>Resumo (PDF)</a>}
                <a className="link" href={urlTranscricao(d)} target="_blank" rel="noreferrer">Transcrição</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
