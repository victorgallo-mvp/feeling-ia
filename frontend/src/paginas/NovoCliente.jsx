import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { anexarDocumento, atualizarCliente, criarCliente, enviarReuniao, registrarSugestaoAnexo, registrarSugestoes } from '../api.js';
import FormCliente from './FormCliente.jsx';
import { itensDe } from './SugestoesCadastro.jsx';

const EXTENSOES_AUDIO = ['.mp3', '.m4a', '.wav', '.ogg', '.opus', '.aac', '.flac', '.mp4', '.webm', '.mov', '.mkv'];
const EXTENSOES = ['.pdf', '.docx', '.txt', ...EXTENSOES_AUDIO]; // gravação só vale como reunião
// Chute inicial do tipo pelo nome do arquivo; a pessoa pode trocar na lista.
const ehAudio = (nome) => EXTENSOES_AUDIO.includes(nome.slice(nome.lastIndexOf('.')).toLowerCase());
const tipoPeloNome = (nome) => (ehAudio(nome) || /reuni|transcri|anota|gemini|meet/i.test(nome) ? 'reuniao' : 'documento');

// Junta as sugestões de várias fontes num único pré-preenchimento do formulário.
function mesclar(fontes) {
  const d = { setor: '', cidade: '', site: '', instagram: '', abrangencia: '', perfil: [], orientacoes: [] };
  for (const s of fontes) {
    for (const k of ['setor', 'cidade', 'site', 'instagram', 'abrangencia']) if (!d[k] && s[k]) d[k] = s[k];
    for (const v of s.perfil_adicoes || []) if (!d.perfil.includes(v)) d.perfil.push(v);
    for (const v of s.orientacoes_adicoes || []) if (!d.orientacoes.includes(v)) d.orientacoes.push(v);
  }
  return { ...d, perfil: d.perfil.join('\n'), orientacoes: d.orientacoes.join('\n').slice(0, 1500) };
}

// Cadastro assistido: nome + documentos → a IA lê e sugere → a pessoa revisa o formulário e salva.
export default function NovoCliente() {
  const navegar = useNavigate();
  const inputRef = useRef(null);
  const [nome, setNome] = useState('');
  const [arquivos, setArquivos] = useState([]); // { arquivo, tipo: 'reuniao'|'documento', estado, mensagem }
  const [fase, setFase] = useState('inicio'); // inicio | processando | revisar
  const [cliente, setCliente] = useState(null);
  const [fontes, setFontes] = useState([]); // sugestões recebidas + como registrar que foram aplicadas
  const [erro, setErro] = useState('');

  function adicionar(lista) {
    const novos = [];
    for (const a of lista || []) {
      const ext = a.name.slice(a.name.lastIndexOf('.')).toLowerCase();
      if (!EXTENSOES.includes(ext)) { setErro(`"${a.name}" não é aceito. Envie PDF, DOCX, TXT ou uma gravação (MP3, M4A, WAV, MP4).`); continue; }
      if (!arquivos.some((x) => x.arquivo.name === a.name)) novos.push({ arquivo: a, tipo: tipoPeloNome(a.name), estado: 'fila', mensagem: '' });
    }
    if (novos.length) { setErro(''); setArquivos((l) => [...l, ...novos]); }
    if (inputRef.current) inputRef.current.value = '';
  }
  const atualizarArquivo = (i, patch) => setArquivos((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  async function comecar(e) {
    e.preventDefault();
    if (!nome.trim()) return;
    setErro('');
    let c = cliente;
    try {
      if (!c) { c = await criarCliente({ nome: nome.trim() }); setCliente(c); }
    } catch (err) { setErro(`Não deu para criar o cliente: ${err.message}`); return; }
    if (!arquivos.length) { navegar(`/clientes/${c.id}`); return; }

    setFase('processando');
    const recebidas = [];
    for (let i = 0; i < arquivos.length; i++) {
      const item = arquivos[i];
      if (item.estado === 'ok') continue;
      atualizarArquivo(i, { estado: 'lendo', mensagem: item.tipo === 'reuniao' ? (ehAudio(item.arquivo.name) ? 'transcrevendo a gravação (uns minutos)…' : 'resumindo a reunião…') : 'lendo o documento…' });
      try {
        if (item.tipo === 'reuniao') {
          const r = await enviarReuniao(c.id, item.arquivo, { titulo: item.arquivo.name.replace(/\.[^.]+$/, '') });
          if (r.sugestoes) recebidas.push({ sugestoes: r.sugestoes, registrar: (dados) => registrarSugestoes(r.documento.id, dados) });
          atualizarArquivo(i, { estado: 'ok', mensagem: r.indexado ? 'resumo no cérebro' : 'resumo salvo (não entrou no cérebro)' });
        } else if (ehAudio(item.arquivo.name)) {
          throw new Error('gravação só pode entrar como reunião — troque o tipo');
        } else {
          const r = await anexarDocumento(c.id, item.arquivo, { extrair: true });
          if (r.sugestoes?.sugestoes) recebidas.push({ sugestoes: r.sugestoes.sugestoes, registrar: (dados) => registrarSugestaoAnexo(c.id, r.sugestoes.id, dados) });
          atualizarArquivo(i, { estado: 'ok', mensagem: r.aviso ? `no cérebro (${r.aviso})` : 'no cérebro' });
        }
      } catch (err) {
        atualizarArquivo(i, { estado: 'erro', mensagem: err.message });
      }
    }
    setFontes(recebidas);
    setFase('revisar');
  }

  async function salvar(dados) {
    const atualizado = await atualizarCliente(cliente.id, dados);
    // marca as sugestões como aplicadas para não reaparecerem como pendentes na página do cliente
    await Promise.all(fontes.map((f) => f.registrar({ aplicadas: itensDe(f.sugestoes).map((i) => i.chave) }).catch(() => {})));
    navegar(`/clientes/${atualizado.id}`);
  }

  const inicial = fase === 'revisar' ? { nome: cliente?.nome || nome, ...mesclar(fontes.map((f) => f.sugestoes)) } : null;
  const resumos = fontes.map((f) => f.sugestoes.resumo_curto).filter(Boolean);
  const falhas = arquivos.filter((a) => a.estado === 'erro');

  return (
    <>
      <Link to="/" className="voltar">← Clientes</Link>
      <div className="cabecalho-pagina">
        <div>
          <h1>Novo cliente</h1>
          <p className="sub">
            {fase === 'revisar'
              ? 'A IA preencheu o que achou nos documentos. Revise, corrija e salve — nada entra sem você confirmar.'
              : 'Informe o nome e, se tiver, suba a transcrição da reunião e os documentos do cliente. A IA lê tudo e monta o cadastro para você revisar.'}
          </p>
        </div>
      </div>

      {fase !== 'revisar' && (
        <section className="bloco">
          <form className="form" onSubmit={comecar}>
            <div className="form-grade">
              <div className="form-campo form-campo-largo">
                <label htmlFor="novo-nome">Nome do cliente</label>
                <input id="novo-nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoComplete="off" disabled={fase === 'processando'} />
              </div>
            </div>

            <h2>Documentos para a IA ler <span className="form-opcional">(opcional)</span></h2>
            <p className="form-ajuda">Transcrição de reunião (vira resumo no cérebro + sugestões), briefing, benchmark, proposta (entram no cérebro + sugestões). Relatórios semanais não entram aqui — suba depois, na página do cliente.</p>
            <label className={`upload${fase === 'processando' ? ' upload-ocupado' : ''}`}>
              <input ref={inputRef} type="file" className="upload-input" multiple accept={EXTENSOES.join(',')} disabled={fase === 'processando'} onChange={(e) => adicionar(e.target.files)} />
              <span><strong>Escolha os arquivos</strong> · PDF, DOCX, TXT ou gravação (MP3, M4A, MP4) · pode selecionar vários</span>
            </label>

            {arquivos.length > 0 && (
              <ul className="lista-anexos">
                {arquivos.map((a, i) => (
                  <li key={a.arquivo.name} className="anexo">
                    <div className="doc-info">
                      <span className="doc-tipo">{a.arquivo.name}</span>
                      {a.mensagem && <span className={`doc-data${a.estado === 'erro' ? ' texto-erro' : ''}`}>{a.mensagem}</span>}
                    </div>
                    <div className="doc-acoes">
                      {a.estado === 'lendo' && <span className="girando girando-mini" aria-hidden="true" />}
                      {a.estado === 'ok' && <span className="etiqueta etiqueta-ok">lido</span>}
                      {a.estado === 'erro' && <span className="etiqueta etiqueta-erro">falhou</span>}
                      <select aria-label={`tipo de ${a.arquivo.name}`} value={a.tipo} disabled={fase === 'processando' || a.estado === 'ok'} onChange={(e) => atualizarArquivo(i, { tipo: e.target.value })}>
                        <option value="reuniao">Transcrição de reunião</option>
                        <option value="documento">Documento do cliente</option>
                      </select>
                      {fase !== 'processando' && a.estado !== 'ok' && (
                        <button type="button" className="link" onClick={() => setArquivos((l) => l.filter((_, k) => k !== i))}>remover</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
            {fase === 'processando' && <p className="aviso" role="status">Lendo os arquivos, um por vez — cada um leva de 20 s a 1 minuto.</p>}

            <div className="acoes form-acoes">
              <button type="submit" className="botao" disabled={fase === 'processando' || !nome.trim()}>
                {fase === 'processando'
                  ? <><span className="girando" aria-hidden="true" /> Lendo…</>
                  : arquivos.length ? `Cadastrar e ler ${arquivos.length} arquivo${arquivos.length > 1 ? 's' : ''}` : 'Cadastrar e preencher à mão'}
              </button>
              <button type="button" className="botao botao-secundario" disabled={fase === 'processando'} onClick={() => navegar('/')}>Cancelar</button>
            </div>
          </form>
        </section>
      )}

      {fase === 'revisar' && (
        <>
          {(resumos.length > 0 || falhas.length > 0) && (
            <section className="bloco">
              <h2>O que a IA leu</h2>
              {resumos.length > 0 && <ul className="lista-simples">{resumos.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              {falhas.length > 0 && (
                <p className="aviso aviso-erro">Não deu para ler: {falhas.map((f) => `${f.arquivo.name} (${f.mensagem})`).join('; ')}. Você pode subir de novo na página do cliente.</p>
              )}
              {fontes.length === 0 && falhas.length === 0 && <p className="vazio">Os arquivos entraram no cérebro, mas não trouxeram nada novo para o cadastro.</p>}
            </section>
          )}
          <section className="bloco">
            <FormCliente inicial={inicial} rotuloSalvar="Salvar cadastro" aoSalvar={salvar} aoCancelar={() => navegar(`/clientes/${cliente.id}`)} />
            <p className="form-ajuda">Cancelar mantém o cliente só com o nome e os documentos já lidos; as sugestões ficam pendentes em "Informações do cliente".</p>
          </section>
        </>
      )}
    </>
  );
}
