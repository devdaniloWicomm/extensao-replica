# Ponte do Figma

Extensão do Chrome que busca as imagens de uma colagem do Figma e entrega ao editor do [gerador-emails](https://gerador-emails.vercel.app/).

## Por que ela existe

O Ctrl+C do Figma leva a árvore inteira de nós, a chave do arquivo e o **hash** de cada imagem — mas **nenhum byte**. Quem busca os bytes é o cliente do Figma, autenticado, chamando um endereço interno com os hashes.

O editor não consegue fazer isso sozinho: o navegador não anexa cookie de outro site numa requisição que sai da nossa origem, e o figma.com não autoriza nossa origem a ler a resposta dele. O bloqueio é a **origem**, não o cookie — guardar uma cópia da sessão não resolveria nada.

A extensão resolve porque faz o pedido de dentro do contexto do figma.com.

## O que ela não faz

**Não lê, não copia e não guarda credencial.** Quem anexa a sessão é o navegador, no momento do pedido. Nada da sessão volta para a página.

Ela também só fala com dois destinos, conferidos em código a cada chamada:

- `https://www.figma.com/` — resolver os hashes
- `https://s3-alpha-sig.figma.com/` — baixar a imagem

Sem essa lista, uma página comprometida poderia pedir à extensão que buscasse qualquer endereço com o cookie do usuário. E ela só é injetada em duas origens, declaradas no manifesto: o site em produção e o `localhost:3100` do desenvolvimento.

## Instalar

1. `chrome://extensions`
2. Liga **Modo do desenvolvedor**, canto superior direito
3. **Carregar sem compactação** e escolhe esta pasta
4. Deixa a pasta onde está: se mover ou apagar, a extensão para

Atualização é manual — baixou uma versão nova, clica em recarregar nesta extensão.

## Testar sem o editor

Clica no ícone da extensão. O painel fala direto com o trabalhador de fundo, então separa as duas metades do problema: se ali funciona e no editor não, o defeito está no recado da página, não no Figma.

Precisa de dois valores, os dois vindos de uma colagem:

- a **chave do arquivo** — a que aparece em `figma.com/design/<chave>/...`
- os **hashes**, 40 dígitos hexadecimais cada, um por linha

E de estar logado em figma.com neste mesmo navegador.

## Conversa com o editor

A página manda uma mensagem para si mesma; o script de conteúdo escuta, repassa ao trabalhador de fundo e devolve a resposta pelo mesmo caminho.

```js
// pedido
window.postMessage({ de: 'gerador-emails', id: '<único>', tipo: 'imagens', fileKey, hashes }, location.origin)

// resposta
{ de: 'ponte-figma', id: '<o mesmo>', ok: true, imagens: { [hash]: { tipo, bytes, base64 } }, faltaram: [hash] }
{ de: 'ponte-figma', id: '<o mesmo>', ok: false, erro: '<motivo>' }
```

Ao carregar, a ponte anuncia `{ de: 'ponte-figma', tipo: 'pronta', versao }`. Quem entrar depois pergunta com `tipo: 'ping'`.

Hash que o Figma não devolver entra em `faltaram` e **não derruba a colagem**: aquela imagem segue o caminho de hoje, colada na mão.

## O risco conhecido

O endereço `/file/<chave>/image/batch` é **interno e não documentado**. Ele é endereçado pelo hash do conteúdo, e é por isso que resolve uma colagem vinda de outra conta — coisa que a API pública, endereçada por arquivo, não faz. O preço é que o Figma pode mudá-lo sem aviso.

Quando quebrar, quebra em `fundo.js`, com mensagem própria separando "você não está logado" de "o endereço mudou".

## Em aberto, a descobrir no primeiro uso real

A chave que vai na URL é a do arquivo **de origem** da colagem. Na medição que originou esta extensão, o cliente do Figma usava a do arquivo **de destino**, que pertencia a quem colava. Se o Figma recusar a chave de origem quando ela for de outra conta, a ponte passa a mandar uma chave de arquivo do próprio usuário — é uma linha em `fundo.js`.
