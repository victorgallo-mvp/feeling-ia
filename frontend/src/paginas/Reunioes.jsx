import { useRef, useState } from 'react';
import { enviarReuniao, urlDownload, urlTranscricao } from '../api.js';

const EXTENSOES = ['.txt', '.md', '.docx', '.pdf'];
// Seção "Reuniões": upload da transcrição + sugestões de cadastro da última reunião pendente.
export default function Reunioes({ clienteId, documentos, ligado, aoNovoDocumento }) {
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState('');
  const [estado, setEstado] = useState({ fase: 'parado', mensagem: '' }); // parado | enviando | ok | erro
  const inputRef = useRef(null);

  async function enviar(arquivo) {
    if (!arquivo || estado.fase === 'enviando') return;
    const ext = arquivo.name.slice(arquivo.name.lastIndexOf('.')).toLowerCase();
    if (!EXTENSOES.includes(ext)) { setEstado({ fase: 'erro', mensagem: `"${arquivo.name}" não é aceito. Envie TXT, MD, DOCX ou PDF.` }); return; }
    setEstado({ fase: 'enviando', mensagem: `Lendo "${arquivo.name}" e montando o resumo — leva de 20s a 1 minuto.` });
    try {
      const r = await enviarReuniao(clienteId, arquivo, { titulo, data_reuniao: data });
      aoNovoDocumento({ ...r.documento, sugestoes: r.sugestoes, aplicadas: [] });
      setTitulo(''); setData('');
      setEstado({ fase: 'ok', mensagem: r.indexado
        ? 'Resumo salvo e adicionado ao cérebro. As sugestões de cadastro estão em "Informações do cliente".'
        : 'Resumo salvo, mas não entrou no cérebro (o n8n de anexar não respondeu). Você pode anexar o PDF manualmente.' });
    } catch (e) {
      setEstado({ fase: 'erro', mensagem: `Não deu para resumir: ${e.message}` });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
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
