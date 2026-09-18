/**
 * Teste da ponte sem o editor: fala direto com o trabalhador de fundo.
 *
 * Serve para separar as duas metades quando algo falha — se aqui funciona e no
 * editor não, o problema é o recado da página, não o Figma.
 */

const $ = id => document.getElementById(id)
const saida = $('saida')

/**
 * A chave sai da aba aberta: `figma.com/design/<chave>/<nome>`, e também `/file/`
 * e `/board/`, que é como links antigos ainda chegam. Digitar isso na mão foi um
 * deslize da primeira versão — no editor ninguém digita, a colagem já traz.
 */
const CHAVE_NA_URL = /^https:\/\/(?:www\.)?figma\.com\/(?:design|file|board|proto)\/([A-Za-z0-9]{10,64})\b/

chrome.tabs.query({ active: true, currentWindow: true }, ([aba]) => {
  const achada = aba?.url?.match(CHAVE_NA_URL)?.[1]
  if (achada) {
    $('chave').value = achada
    $('chave').title = `detectada na aba: ${aba.url}`
    $('hashes').focus()
  } else {
    $('dica').textContent = 'Abra o arquivo no Figma e clique aqui de novo para a chave vir sozinha.'
  }
})

const escapar = texto => texto.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))

const emKb = bytes => `${(bytes / 1024).toFixed(1)} KB`

/**
 * Colar aqui não funciona e a caixa não deixava isso claro: o Ctrl+V entrega a
 * versão em TEXTO PURO da colagem, que são só os nomes das camadas. A estrutura,
 * com a chave e os hashes, viaja na versão HTML, e só o editor lê aquela. Aqui a
 * gente aproveita o que dá — a chave — e diz onde é o lugar certo.
 */
$('hashes').addEventListener('paste', evento => {
  const html = evento.clipboardData?.getData('text/html') ?? ''
  if (!html.includes('(figma)')) return

  evento.preventDefault()
  const meta = html.match(/\(figmeta\)([A-Za-z0-9+/=]+)\(\/figmeta\)/)?.[1]
  let chave = ''
  try {
    chave = meta ? (JSON.parse(atob(meta)).fileKey ?? '') : ''
  } catch {
    chave = ''
  }
  if (chave) $('chave').value = chave

  mostrarErro(
    'Isso é uma colagem do Figma, e ela não cabe aqui: esta caixa só recebe texto, e os hashes viajam na parte que só o editor lê. ' +
      (chave ? 'Peguei a chave do arquivo. ' : '') +
      'Cole no editor — lá não se digita nada.',
  )
})

$('buscar').addEventListener('click', () => {
  const fileKey = $('chave').value.trim()
  const hashes = $('hashes')
    .value.split(/\s+/)
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)

  saida.innerHTML = ''
  $('buscar').disabled = true

  chrome.runtime.sendMessage({ tipo: 'imagens', fileKey, hashes }, resposta => {
    $('buscar').disabled = false

    const erro = chrome.runtime.lastError
    if (erro) return mostrarErro(erro.message)
    if (!resposta?.ok) return mostrarErro(resposta?.erro ?? 'sem resposta')

    const achadas = Object.entries(resposta.imagens)
    const partes = achadas.map(
      ([hash, img]) =>
        `<div class="imagem">
           <img src="data:${escapar(img.tipo)};base64,${img.base64}" alt="">
           <div><code>${escapar(hash.slice(0, 12))}…</code><br>${escapar(img.tipo)} · ${emKb(img.bytes)}</div>
         </div>`,
    )

    if (resposta.faltaram.length) {
      partes.push(`<p class="erro">Não vieram: ${resposta.faltaram.length} de ${achadas.length + resposta.faltaram.length}</p>`)
    }
    saida.innerHTML = partes.join('') || '<p class="erro">Nenhuma imagem voltou.</p>'
  })
})

function mostrarErro(mensagem) {
  saida.innerHTML = `<p class="erro">${escapar(String(mensagem))}</p>`
}
