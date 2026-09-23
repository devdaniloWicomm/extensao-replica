/**
 * O único lugar que fala com o Figma.
 *
 * A extensão NÃO lê, não copia e não guarda cookie. Ela roda código DENTRO da aba
 * do figma.com, onde a própria página expõe a API de plugin (`window.figma`), e
 * pede ao Figma o PNG de cada nó — exatamente o que ele desenha na caixa: recorte
 * de qualquer modo, opacidade, vetor. Nada da sessão volta para a página do editor.
 *
 * Só leitura: nenhuma chamada daqui altera o arquivo do usuário. `getNodeByIdAsync`
 * e `exportAsync` não mexem em nada; seleção, visibilidade e nomes ficam como estão.
 *
 * `window.figma` só enxerga o arquivo ABERTO naquela aba — por isso a aba tem de
 * ser a do `fileKey` da colagem. Não havendo, abre uma em segundo plano e fecha.
 */

const CHAVE_DE_ARQUIVO = /^[A-Za-z0-9]{10,64}$/
/** Id da colada: `4183:2497`, ou filho de instância `4183:2569;316:4909`. */
const ID_DE_NO = /^\d+:\d+(;\d+:\d+)*$/
const ID_DE_FRAME = /^\d+:\d+$/
const MAX_PEDIDOS = 300
const ESPERA_API_MS = 30_000

function pedidoValido(p) {
  return (
    p && typeof p === 'object' &&
    typeof p.chave === 'string' && p.chave.length > 0 && p.chave.length <= 300 &&
    typeof p.id === 'string' && ID_DE_NO.test(p.id) &&
    typeof p.raiz === 'string' && ID_DE_FRAME.test(p.raiz) &&
    Array.isArray(p.caminho) && p.caminho.length <= 30 &&
    p.caminho.every(c => c && typeof c.nome === 'string' && c.nome.length <= 200 && Number.isInteger(c.indice) && c.indice >= 0)
  )
}

/**
 * Roda DENTRO da página do figma.com (`world: 'MAIN'`). Função isolada: o corpo é
 * serializado e injetado, então não fecha sobre nada daqui.
 *
 * O nó é achado em três tentativas, da mais exata para a mais tolerante:
 * 1. o id como veio (nó que não mora em instância);
 * 2. `I` + id (é assim que a API de plugin escreve filho de instância);
 * 3. o caminho de nomes desde o frame — filho de componente REMOTO tem, na API, o
 *    id da biblioteca, que a colada não conhece (medido: `I4183:2569;316:4909`).
 *    Entre irmãos de mesmo nome vale o `indice`, contando só os visíveis, que é o
 *    que a colada também conta.
 */
async function exportarNaPagina(pedidos, escala) {
  if (!window.figma || typeof window.figma.getNodeByIdAsync !== 'function') return { erro: 'sem-api' }
  const porId = async id => {
    try { return await window.figma.getNodeByIdAsync(id) } catch { return null }
  }
  const achar = async p => {
    for (const id of [p.id, 'I' + p.id]) {
      const n = await porId(id)
      if (n) return n
    }
    let n = await porId(p.raiz)
    for (const passo of p.caminho) {
      if (!n || !n.children) return null
      n = n.children.filter(c => c.visible !== false && c.name === passo.nome)[passo.indice] ?? null
    }
    return n
  }
  const imagens = {}
  const faltaram = []
  for (const p of pedidos) {
    try {
      const n = await achar(p)
      if (!n || typeof n.exportAsync !== 'function') { faltaram.push(p.chave); continue }
      const bytes = await n.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: escala } })
      // `String.fromCharCode(...bytes)` de uma vez estoura a pilha em imagem grande.
      let texto = ''
      for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      imagens[p.chave] = btoa(texto)
    } catch {
      faltaram.push(p.chave)
    }
  }
  return { imagens, faltaram }
}

/** Roda na página: espera o editor do Figma expor `window.figma` (aba recém-aberta). */
async function esperarApiNaPagina(esperaMs) {
  const fim = Date.now() + esperaMs
  while (Date.now() < fim) {
    if (window.figma && typeof window.figma.getNodeByIdAsync === 'function') return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

/** A aba do arquivo da colagem. `criada` diz se fomos nós que abrimos, para não fechar a do usuário. */
async function abaDoArquivo(fileKey) {
  const abas = await chrome.tabs.query({ url: ['https://www.figma.com/design/*', 'https://www.figma.com/file/*'] })
  const existente = abas.find(t => typeof t.url === 'string' && (t.url.includes(`/${fileKey}/`) || t.url.endsWith(`/${fileKey}`)))
  if (existente) return { id: existente.id, criada: false }
  const nova = await chrome.tabs.create({ url: `https://www.figma.com/design/${fileKey}`, active: false })
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

async function rodarNaAba(abaId, func, args) {
  const [resultado] = await chrome.scripting.executeScript({ target: { tabId: abaId }, world: 'MAIN', func, args })
  return resultado?.result
}

async function exportar({ fileKey, pedidos, escala }) {
  if (!CHAVE_DE_ARQUIVO.test(String(fileKey ?? ''))) throw new Error('chave de arquivo inválida')
  if (!Array.isArray(pedidos) || !pedidos.length) throw new Error('nenhum nó pedido')
  if (pedidos.length > MAX_PEDIDOS) throw new Error(`mais de ${MAX_PEDIDOS} nós num pedido só`)
  if (!pedidos.every(pedidoValido)) throw new Error('pedido de nó inválido')
  if (![1, 2, 3].includes(escala)) throw new Error('escala inválida')

  const aba = await abaDoArquivo(fileKey)
  try {
    const pronta = await rodarNaAba(aba.id, esperarApiNaPagina, [ESPERA_API_MS])
    if (!pronta) throw new Error('o Figma não abriu o arquivo nesta aba a tempo — abra o arquivo no figma.com e cole de novo')
    const saida = await rodarNaAba(aba.id, exportarNaPagina, [pedidos, escala])
    if (!saida) throw new Error('não consegui rodar dentro da página do Figma')
    if (saida.erro === 'sem-api') throw new Error('a página do Figma não expôs a API — abra o arquivo no figma.com e cole de novo')
    return { imagens: saida.imagens ?? {}, faltaram: saida.faltaram ?? [] }
  } finally {
    if (aba.criada) await chrome.tabs.remove(aba.id).catch(() => {})
  }
}

chrome.runtime.onMessage.addListener((pedido, _remetente, responder) => {
  if (pedido?.tipo === 'ping') {
    responder({ ok: true, versao: chrome.runtime.getManifest().version })
    return false
  }
  if (pedido?.tipo === 'exportar') {
    exportar(pedido).then(
      dados => responder({ ok: true, ...dados }),
      erro => responder({ ok: false, erro: String(erro?.message || erro) }),
    )
    return true // resposta assíncrona
  }
  responder({ ok: false, erro: `pedido desconhecido: ${pedido?.tipo}` })
  return false
})
