/**
 * O único lugar que fala com o Figma.
 *
 * A extensão NÃO lê, não copia e não guarda cookie. Ela faz o pedido a partir do
 * contexto do figma.com e o navegador anexa a sessão sozinho — é a diferença entre
 * pedir o item e guardar a chave do cofre. Nada da sessão volta para a página.
 *
 * O endereço `/file/<chave>/image/batch` é INTERNO do Figma, não documentado: ele
 * é endereçado pelo hash do conteúdo da imagem, e é por isso que resolve uma
 * colagem vinda de outra conta — coisa que a API pública, endereçada por arquivo,
 * não faz. O preço é que o Figma pode mudá-lo sem aviso; quando quebrar, quebra
 * aqui, com mensagem própria.
 */

/** Chave de arquivo do Figma: o que aparece em figma.com/design/<chave>/... */
const CHAVE_DE_ARQUIVO = /^[A-Za-z0-9]{10,64}$/

/** Hash da imagem: SHA-1 em hexadecimal, os mesmos 40 dígitos que a colada carrega. */
const HASH_DE_IMAGEM = /^[a-f0-9]{40}$/

/** Só estes destinos, e nada mais: sem isto a extensão viraria um procurador confuso. */
const DESTINOS = ['https://www.figma.com/', 'https://s3-alpha-sig.figma.com/']

const permitido = url => DESTINOS.some(d => url.startsWith(d))

/**
 * `FileReader` não existe em service worker do Manifest V3, e espalhar o array em
 * `String.fromCharCode(...)` de uma vez estoura a pilha com imagem grande — daí o
 * pedaço de 32 KB.
 */
function paraBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let texto = ''
  const PEDACO = 0x8000
  for (let i = 0; i < bytes.length; i += PEDACO) {
    texto += String.fromCharCode.apply(null, bytes.subarray(i, i + PEDACO))
  }
  return btoa(texto)
}

/**
 * Roda DENTRO da página do figma.com. É uma função isolada de propósito: o corpo
 * dela é serializado e injetado noutro contexto, então não pode fechar sobre nada
 * daqui.
 *
 * Medido: a mesma chamada feita do trabalhador de fundo volta 403, mesmo com o
 * usuário logado. Não é o cookie que falta — o pedido sai com origem
 * `chrome-extension://…` e o Figma recusa. De dentro da página a origem é
 * figma.com de verdade, que é como o próprio cliente dele chama. Nada é
 * falsificado: o pedido é feito no lugar a que ele pertence.
 */
async function resolverNaPagina(chaveDoArquivo, hashes) {
  const resposta = await fetch(`https://www.figma.com/file/${chaveDoArquivo}/image/batch`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha1s: hashes }),
  })
  if (!resposta.ok) return { erro: resposta.status }
  const corpo = await resposta.json()
  return { urls: corpo?.meta?.s3_urls ?? null }
}

/** Uma aba do figma.com para emprestar a origem. Reusa a que estiver aberta; se não
 *  houver nenhuma, abre uma em segundo plano e fecha depois — `criada` diz qual é o
 *  caso, para não fechar uma aba que é do usuário. */
async function abaDoFigma() {
  const [existente] = await chrome.tabs.query({ url: 'https://www.figma.com/*' })
  if (existente) return { id: existente.id, criada: false }
  const nova = await chrome.tabs.create({ url: 'https://www.figma.com/', active: false })
  // A injeção precisa do documento de pé; sem esta espera o `executeScript` erra
  // com "Frame with ID 0 is showing error page".
  await new Promise(pronto => {
    const ouvir = (id, info) => {
      if (id !== nova.id || info.status !== 'complete') return
      chrome.tabs.onUpdated.removeListener(ouvir)
      pronto()
    }
    chrome.tabs.onUpdated.addListener(ouvir)
  })
  return { id: nova.id, criada: true }
}

/** Os endereços assinados de cada hash, numa chamada só, emprestando a origem do figma.com. */
async function urlsAssinadas(chaveDoArquivo, hashes) {
  const aba = await abaDoFigma()
  let saida
  try {
    const [resultado] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      world: 'MAIN',
      func: resolverNaPagina,
      args: [chaveDoArquivo, hashes],
    })
    saida = resultado?.result
  } finally {
    if (aba.criada) await chrome.tabs.remove(aba.id).catch(() => {})
  }

  if (!saida) throw new Error('não consegui rodar dentro da página do Figma')
  if (saida.erro === 401 || saida.erro === 403) {
    throw new Error(
      `o Figma recusou (${saida.erro}) mesmo de dentro da página dele. ` +
        'Confira se você está logado em figma.com neste navegador, e se a chave do arquivo é de um arquivo que você abre.',
    )
  }
  if (saida.erro) throw new Error(`o Figma respondeu ${saida.erro} ao resolver os hashes`)
  if (!saida.urls || typeof saida.urls !== 'object') throw new Error('resposta do Figma sem meta.s3_urls')
  return saida.urls
}

/** Baixa um endereço assinado e devolve os bytes. Sem cookie: a assinatura já autoriza. */
async function baixar(url) {
  if (!permitido(url)) throw new Error('endereço assinado fora do domínio esperado')
  const resposta = await fetch(url, { credentials: 'omit' })
  if (!resposta.ok) throw new Error(`download respondeu ${resposta.status}`)
  const buffer = await resposta.arrayBuffer()
  return {
    tipo: resposta.headers.get('content-type') || 'application/octet-stream',
    bytes: buffer.byteLength,
    base64: paraBase64(buffer),
  }
}

/**
 * Hash que o Figma não devolver não é erro: aquela imagem segue o caminho de hoje
 * (colar na mão). Por isso o resultado separa `imagens` de `faltaram`, em vez de
 * derrubar a colagem inteira por causa de uma.
 */
async function buscarImagens({ fileKey, hashes }) {
  if (!CHAVE_DE_ARQUIVO.test(String(fileKey ?? ''))) throw new Error('chave de arquivo inválida')
  if (!Array.isArray(hashes) || !hashes.length) throw new Error('nenhum hash pedido')
  if (hashes.length > 200) throw new Error('mais de 200 hashes num pedido só')

  const limpos = [...new Set(hashes.map(String))]
  const invalido = limpos.find(h => !HASH_DE_IMAGEM.test(h))
  if (invalido) throw new Error(`hash inválido: ${invalido.slice(0, 16)}`)

  const mapa = await urlsAssinadas(fileKey, limpos)
  const imagens = {}
  const faltaram = []

  for (const hash of limpos) {
    const url = mapa[hash]
    if (typeof url !== 'string' || !url) {
      faltaram.push(hash)
      continue
    }
    try {
      imagens[hash] = await baixar(url)
    } catch (erro) {
      faltaram.push(hash)
      console.warn(`[ponte] ${hash}: ${erro.message}`)
    }
  }

  return { imagens, faltaram }
}

chrome.runtime.onMessage.addListener((pedido, _remetente, responder) => {
  if (pedido?.tipo === 'ping') {
    responder({ ok: true, versao: chrome.runtime.getManifest().version })
    return false
  }

  if (pedido?.tipo === 'imagens') {
    buscarImagens(pedido).then(
      dados => responder({ ok: true, ...dados }),
      erro => responder({ ok: false, erro: String(erro?.message || erro) }),
    )
    return true // resposta assíncrona
  }

  responder({ ok: false, erro: `pedido desconhecido: ${pedido?.tipo}` })
  return false
})
