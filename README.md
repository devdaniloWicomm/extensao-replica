# Ponte do Figma

Extensão do Chrome que exporta o PNG de um nó de uma colagem do Figma e entrega ao editor do [gerador-emails](https://gerador-emails.vercel.app/).

## Por que ela existe

O Ctrl+C do Figma leva a árvore inteira de nós e a chave do arquivo — mas nenhum byte de imagem. Quem desenha o PNG de um nó, com recorte, opacidade e vetores exatamente como aparecem na caixa, é a própria API de plugin do Figma (`window.figma`), e ela só existe DENTRO da aba do editor, aberta no arquivo certo.

O editor não consegue fazer isso sozinho: uma página comum não tem acesso a `window.figma`. A extensão resolve porque injeta código na aba do figma.com e pede o export dali.

## O que ela não faz

**Não lê, não copia e não guarda credencial.** Ela roda `getNodeByIdAsync` e `exportAsync` — chamadas de leitura, que não mexem em seleção, visibilidade, nomes ou qualquer outra coisa do arquivo. Nada da sessão volta para a página do editor.

Ela só é injetada em duas origens, declaradas no manifesto: o site em produção e o `localhost:3100` do desenvolvimento. E só fala com uma aba do figma.com — a do `fileKey` pedido; se não houver uma aberta, abre uma em segundo plano e fecha depois.

## Instalar

1. `chrome://extensions`
2. Liga **Modo do desenvolvedor**, canto superior direito
3. **Carregar sem compactação** e escolhe esta pasta
4. Deixa a pasta onde está: se mover ou apagar, a extensão para

Atualização é manual — baixou uma versão nova, clica em recarregar nesta extensão.

## Testar sem o editor

Clica no ícone da extensão. O painel fala direto com o trabalhador de fundo, então separa as duas metades do problema: se ali funciona e no editor não, o defeito está no recado da página, não no Figma.

Precisa de dois valores:

- a **chave do arquivo** — a que aparece em `figma.com/design/<chave>/...`
- o **id do nó** — algo como `4183:2497`

E de estar com o arquivo aberto (ou abrível) numa aba do figma.com, logado.

## Conversa com o editor

A página manda uma mensagem para si mesma; o script de conteúdo escuta, repassa ao trabalhador de fundo e devolve a resposta pelo mesmo caminho.

```js
// pedido
window.postMessage(
  { de: 'gerador-emails', id: '<único>', tipo: 'exportar', fileKey, pedidos, escala },
  location.origin,
)

// resposta
{ de: 'ponte-figma', id: '<o mesmo>', ok: true, imagens: { [chave]: '<PNG em base64>' }, faltaram: [chave] }
{ de: 'ponte-figma', id: '<o mesmo>', ok: false, erro: '<motivo>' }
```

Cada item de `pedidos` é `{ chave, id, raiz, caminho }`: `chave` identifica o pedido na resposta, `id` é o id do nó como a colagem trouxe, `raiz` é o id do frame que contém o nó, e `caminho` é a lista de nomes (com índice, para irmãos repetidos) a percorrer a partir da raiz — usada quando o `id` não é achado direto, caso de filho de componente remoto.

Ao carregar, a ponte anuncia `{ de: 'ponte-figma', tipo: 'pronta', versao }`. Quem entrar depois pergunta com `tipo: 'ping'`.

Nó que não for achado entra em `faltaram` e **não derruba a colagem**: aquela imagem segue o caminho de hoje, colada na mão.
