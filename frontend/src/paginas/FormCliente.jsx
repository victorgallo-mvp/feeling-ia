import { useState } from 'react';

// Roteiro do perfil: são as lacunas que o briefing marca como "[a confirmar com o cliente]".
const ROTEIRO = `Objetivo da campanha:
Público-alvo:
Diferenciais da marca/produto:
Produtos ou serviços foco:
Ticket médio:
Canais de venda (site, WhatsApp, loja):
Principais concorrentes:
Verba mensal de mídia:
Tom de voz:
Observações:`;

const VAZIO = { nome: '', setor: '', cidade: '', conta_id: '', perfil: '' };

// Formulário de criar/editar cliente. `aoSalvar(dados)` deve devolver uma Promise.
export default function FormCliente({ inicial, rotuloSalvar, aoSalvar, aoCancelar }) {
  const [dados, setDados] = useState(() => {
    const d = { ...VAZIO };
    for (const k of Object.keys(VAZIO)) d[k] = inicial?.[k] ?? '';
    return d;
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const campo = (nome) => ({
    id: `campo-${nome}`,
    value: dados[nome],
    onChange: (e) => setDados((d) => ({ ...d, [nome]: e.target.value })),
  });

  // itens do roteiro que ainda não aparecem no texto (as linhas sem resposta não são salvas)
  const itensFaltando = ROTEIRO.split('\n').filter((item) => !dados.perfil.includes(item));
  const completarRoteiro = () =>
    setDados((d) => ({ ...d, perfil: [d.perfil.trimEnd(), ...itensFaltando].filter(Boolean).join('\n') }));

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      // linhas do roteiro que ficaram sem resposta não vão pra IA
      const semResposta = new Set(ROTEIRO.split('\n'));
      const perfil = dados.perfil.split('\n').filter((ln) => !semResposta.has(ln.trim())).join('\n').trim();
      await aoSalvar({ ...dados, perfil });
    } catch (err) {
      setErro(err.message);
      setSalvando(false);
    }
  }

  return (
    <form className="form" onSubmit={enviar}>
      <div className="form-grade">
        <div className="form-campo form-campo-largo">
          <label htmlFor="campo-nome">Nome do cliente</label>
          <input {...campo('nome')} required autoComplete="off" />
        </div>
        <div className="form-campo">
          <label htmlFor="campo-setor">Setor</label>
          <input {...campo('setor')} placeholder="ex.: e-commerce de autopeças" autoComplete="off" />
        </div>
        <div className="form-campo">
          <label htmlFor="campo-cidade">Cidade</label>
          <input {...campo('cidade')} placeholder="ex.: Divinópolis" autoComplete="off" />
        </div>
        <div className="form-campo form-campo-largo">
          <label htmlFor="campo-conta_id">ID da conta no Sentinel</label>
          <input {...campo('conta_id')} placeholder="ex.: alemao-performance" autoComplete="off" spellCheck="false" />
          <p className="form-ajuda">
            Precisa ser idêntico ao <code>conta_id</code> do Sentinel. Se estiver errado, o relatório sai sem números — e sem avisar. Sem ele, só pesquisa e briefing funcionam.
          </p>
        </div>
        <div className="form-campo form-campo-largo">
          <div className="form-rotulo-linha">
            <label htmlFor="campo-perfil">Perfil do cliente</label>
            {itensFaltando.length > 0 && (
              <button type="button" className="link" onClick={completarRoteiro}>
                {dados.perfil.trim() ? 'Completar com o roteiro' : 'Usar roteiro'}
              </button>
            )}
          </div>
          <textarea {...campo('perfil')} rows={11} placeholder={ROTEIRO} />
          <p className="form-ajuda">
            O que a equipe sabe sobre o cliente. A IA usa esse texto na pesquisa e no briefing. Documentos longos vão pelo upload.
          </p>
        </div>
      </div>

      {erro && <p className="aviso aviso-erro" role="alert">Não deu para salvar: {erro}</p>}

      <div className="acoes form-acoes">
        <button type="submit" className="botao" disabled={salvando}>
          {salvando ? <><span className="girando" aria-hidden="true" /> Salvando…</> : rotuloSalvar}
        </button>
        <button type="button" className="botao botao-secundario" disabled={salvando} onClick={aoCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
