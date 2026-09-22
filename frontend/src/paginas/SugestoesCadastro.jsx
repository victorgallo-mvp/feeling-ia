import { useState } from 'react';
import { atualizarCliente } from '../api.js';

const CAMPOS = { setor: 'Setor', cidade: 'Cidade', site: 'Site', instagram: 'Instagram', abrangencia: 'Abrangência' };

// Uma fonte de sugestões (reunião ou anexo) vira uma lista plana de itens marcáveis.
export function itensDe(sugestoes) {
  if (!sugestoes) return [];
  const itens = [];
  for (const k of Object.keys(CAMPOS)) if (sugestoes[k]) itens.push({ chave: k, rotulo: CAMPOS[k], valor: sugestoes[k], grupo: 'cadastro' });
  (sugestoes.perfil_adicoes || []).forEach((v, i) => itens.push({ chave: `perfil:${i}`, rotulo: 'Perfil', valor: v, grupo: 'perfil' }));
  (sugestoes.orientacoes_adicoes || []).forEach((v, i) => itens.push({ chave: `orientacoes:${i}`, rotulo: 'Orientações', valor: v, grupo: 'orientacoes' }));
  return itens;
}

// Painel de UMA fonte pendente. `fonte` = { chave, origem, resumo, itens, aplicadas, registrar(dados) }.
export default function SugestoesCadastro({ fonte, cliente, aoAtualizarCliente, aoRegistrado }) {
  const [desmarcados, setDesmarcados] = useState(() => new Set());
  const [ocupado, setOcupado] = useState(false);
  const restantes = fonte.itens.filter((i) => !fonte.aplicadas.includes(i.chave));
  const marcado = (c) => !desmarcados.has(c);
  const alternar = (c) => setDesmarcados((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });

  async function aplicar() {
    const escolhidos = restantes.filter((i) => marcado(i.chave));
    if (!escolhidos.length) return;
    setOcupado(true);
    try {
      const dados = {
        nome: cliente.nome, setor: cliente.setor, cidade: cliente.cidade, conta_id: cliente.conta_id, instagram: cliente.instagram,
        site: cliente.site, google_ads_id: cliente.google_ads_id, abrangencia: cliente.abrangencia,
        whatsapp_ativo: cliente.whatsapp_ativo, whatsapp_webhook: cliente.whatsapp_webhook,
        perfil: cliente.perfil || '', orientacoes: cliente.orientacoes || '',
      };
      for (const i of escolhidos) {
        if (i.grupo === 'cadastro') dados[i.chave] = i.valor;
        else if (i.grupo === 'perfil') dados.perfil = `${dados.perfil.trimEnd()}\n${i.valor}`.trim();
        else dados.orientacoes = `${dados.orientacoes.trimEnd()}\n${i.valor}`.trim();
      }
      if (dados.orientacoes.length > 1500) throw new Error('as orientações passariam de 1.500 caracteres — edite a ficha e enxugue antes');
      const atualizado = await atualizarCliente(cliente.id, dados);
      const aplicadas = [...fonte.aplicadas, ...escolhidos.map((i) => i.chave)];
      const r = await fonte.registrar({ aplicadas });
      aoAtualizarCliente(atualizado);
      aoRegistrado?.(fonte, { aplicadas }, r);
      setDesmarcados(new Set());
    } catch (e) {
      window.alert(`Não deu para aplicar: ${e.message}`);
    } finally {
      setOcupado(false);
    }
  }

  async function descartar() {
    if (!window.confirm(`Descartar as sugestões de "${fonte.origem}"?`)) return;
    setOcupado(true);
    try {
      const r = await fonte.registrar({ descartar: true });
      aoRegistrado?.(fonte, { descartar: true }, r);
    } catch (e) {
      window.alert(`Não deu para descartar: ${e.message}`);
    } finally {
      setOcupado(false);
    }
  }

  if (!restantes.length) return null;
  return (
    <div className="sugestoes">
      <div className="bloco-topo">
        <h3>Sugestões para o cadastro</h3>
        <span className="doc-data">de: {fonte.origem}</span>
      </div>
      {fonte.resumo && <p className="sugestoes-resumo">{fonte.resumo}</p>}
      <ul className="lista-sugestoes">
        {restantes.map((i) => (
          <li key={i.chave}>
            <label className="sugestao">
              <input type="checkbox" checked={marcado(i.chave)} onChange={() => alternar(i.chave)} disabled={ocupado} />
              <span className="sugestao-rotulo">{i.rotulo}</span>
              <span className="sugestao-valor">{i.valor}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="acoes">
        <button type="button" className="botao" disabled={ocupado || !restantes.some((i) => marcado(i.chave))} onClick={aplicar}>
          {ocupado ? 'Aplicando…' : 'Aplicar selecionadas ao cadastro'}
        </button>
        <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={descartar}>Descartar</button>
      </div>
      <p className="form-ajuda">Setor, cidade, site, Instagram e abrangência substituem o valor atual; perfil e orientações recebem as linhas novas no fim. Nada muda sem clicar em aplicar.</p>
    </div>
  );
}
