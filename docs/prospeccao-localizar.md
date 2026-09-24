# Prospecção — Localizar: como o sistema acha a ficha, o Instagram e o site

> A lógica vive no n8n (workflow `OabFxzK4eD9aDFTZ`, "Prospecção — Localizar"), não neste
> repositório. O cockpit só dispara o webhook e recebe o callback. Este documento existe porque
> a decisão de "é esta empresa ou não" é a parte mais delicada do produto — vai para uma reunião
> com um prospect — e o canvas do n8n não conta o porquê.

## O contrato

```
POST /api/prospects/:id/localizar        →  202, o cockpit devolve na hora
  cockpit → webhook n8n { nome, cidade, setor, site?, instagram?, callback_url, callback_token }
  n8n responde { aceito: true } e continua rodando (a resposta síncrona era cortada em ~100s)
  n8n → POST /api/prospects/:id/localizar/concluir  { gmn, instagram, sites, decisao, avisos, falhas_de_coleta, rodada_2 }
```

A cidade é obrigatória. Sem ela nada pode ser confirmado como "alta": é ela que separa empresas
homônimas em outros estados.

## As duas regras que governam tudo

**1. Evidência, nunca parecença de nome.** Nome parecido não confirma nada. O que confirma é:
o perfil estar linkado no site oficial da ficha; o telefone da bio bater com o da ficha; a bio
citar a cidade do negócio; o link da bio ser o site da ficha; o `@` estar escrito no campo "site"
da própria ficha do Google; ou a pessoa ter informado no cadastro. Fora disso é "media" ou "baixa",
e **não achar é uma resposta boa** — melhor que um palpite que vai para uma reunião.

**2. Falha de coleta não é ausência.** Um 502 do coletor não significa que a empresa não tem ficha
nem que o perfil não existe. Toda falha volta em `falhas_de_coleta` e o texto diz para repetir.
O documento de diagnóstico nunca pode pontuar zero por causa de uma falha nossa.

## Rodada 1

1. **Apify Ficha** — `compass~crawler-google-places`, com o nome e o setor em `searchStringsArray`
   e a cidade em `locationQuery` no formato `"Cidade, UF, Brazil"`. A cidade *dentro* do texto de
   busca é ignorada pelo ator: foi uma das causas de "não acha a ficha".
2. **Escolher Ficha** — pontua por evidência. Tokens genéricos do setor (`transportes`, `motos`,
   `consultoria`…) não contam como distintivos, senão qualquer transportadora casa com "SA
   Transportes". Nome colado também vale ("Trailland" ≡ "Trail Land"). A cidade é comparada com o
   campo `city`, não com o endereço inteiro (senão "R. José Cândido **De Oliveira**, Machado-MG"
   passa como Oliveira).
   - **Rede social no campo "site" não é site.** Negócio pequeno costuma pôr Instagram ou WhatsApp
     ali. Vira `ficha_so_com_rede` — ausência real de site, não falha — e não vai para `site_alvo`,
     porque o `Baixar Site` não consegue ler instagram.com.
   - **`instagram_da_ficha`**: quando o campo "site" é um link do Instagram, o `@` é extraído. É o
     dono dizendo qual é o perfil, na ficha dele. Evidência mais forte que existe.
3. **Baixar Site / Extrair do Site** — lê o site oficial e tira dele `@`, WhatsApp, telefone e
   Facebook. O telefone é comparado pelos 8 últimos dígitos (ignora +55 e formatação de DDD).
4. **Palpites de @** — nenhum índice de busca acha perfil de empresa pequena
   (`@strikenutritionbrasil` existe e não é indexado), então montamos candidatos e verificamos
   direto no Instagram. **A ordem importa, porque só os 6 primeiros são consultados:**
   1. informado no cadastro
   2. `instagram_da_ficha` (o `@` que está na ficha)
   3. **o nome como está na ficha**, não como a pessoa digitou — a pessoa escreve "Lordrox", a
      ficha diz "Lordroxs", e `@lordroxs` é a loja com 43 mil seguidores enquanto `@lordrox` é uma
      conta pessoal com 159. Uma letra.
   4. o que veio do site oficial
   5. variações do nome digitado (colado, sem palavra final genérica, com ponto, com underscore)
5. **Apify Instagram** — verifica cada `@`. Volta bio, seguidores, conta comercial, link externo.
   O ator **ecoa o username pedido mesmo quando o perfil não existe**, então `existe` é decidido
   por ter dado de verdade (seguidores, posts, bio ou nome), não pela presença do campo.

## Rodada 2 (fallback)

Existe porque a rodada 1 é uma linha reta de mão única: a ficha é buscada **primeiro e uma única
vez**, e a evidência descoberta depois — a cidade na bio, o telefone, o site — não podia voltar
para refazer aquela busca. O caso que revelou isso foi a Na Casquinha, cuja bio lista
`📍Três Pontas 📍Varginha 📍Boa Esperança …`: a resposta de onde procurar a ficha estava na mão e
o fluxo não tinha como usar.

**Quando roda** (`Rodada 2?`): só quando a rodada 1 **não achou ficha**, **não falhou na coleta**
e **achou ao menos um perfil verificado** que declara uma cidade diferente da que já buscamos.
Se a rodada 1 já resolveu, ou se a coleta falhou (aí o certo é repetir, não deduzir), não roda —
e o motivo vai nos avisos.

**O que ela usa:** as cidades que o próprio perfil declara (marcadores 📍 e padrões
`Cidade - UF` / `Cidade/UF`), e os nomes que a cadeia revelou (o `fullName` do perfil, o `<title>`
do site). A UF de referência é a do cadastro — o estado erra muito menos que a cidade.

**A regra de segurança:** a rodada 2 **só amplia a lista de candidatos; nunca decide.** Quem decide
continua sendo o `Conferir`, vendo as duas rodadas juntas. Toda ficha que vem dela é marcada
`rodada: 2, derivado: true` e **não pode ser "alta" só por ter sido achada** — ela nasceu de uma
cidade que saiu de um perfil que ainda não está confirmado, e se o perfil estiver errado a ficha
dele também está. Para virar "alta" precisa de evidência própria: telefone igual ao do perfil,
site igual ao link da bio, ou nome idêntico com a categoria certa. Isso contém o risco de uma
cadeia se apoiar num Instagram errado.

Ficha achada na rodada 2 quase sempre significa que **a cidade do cadastro está errada** — o aviso
diz isso, com a cidade certa.

## Conferir

Haiku 4.5, temperatura padrão, resposta só em JSON. Recebe tudo: as duas rodadas de fichas, o site
lido, os perfis verificados e os resultados de busca na web. Só pode escolher uma ficha **cujo nome
seja idêntico** a uma das listadas — já aconteceu de nomear uma ficha tirada de um site de CNPJ, que
não é ficha do Google. `Montar Candidatos` valida isso de novo e descarta se não bater.

## Armadilhas já pagas

- **Setor errado é pior que setor vazio.** Vazio não penaliza; errado veta. O Lordroxs (loja de
  celulares) foi rebaixado para "baixa" porque o setor no cadastro dizia "gestão".
- Nome cujos tokens são **todos** palavras de setor ("Sport Fitness") passa por
  "todos os tokens presentes" em qualquer ficha do ramo — "Centro de Treinamento Sport Gym Fitness"
  foi marcado "alta" indevidamente. Correção conhecida e não aplicada: exigir que os tokens
  distintivos apareçam **adjacentes**, não espalhados.
- Site que existe mas bloqueia robô vale `nota: null` e redistribui peso, nunca 0.
