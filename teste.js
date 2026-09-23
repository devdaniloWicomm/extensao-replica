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
    $('id').focus()
  } else {
    $('dica').textContent = 'Abra o arquivo no Figma e clique aqui de novo para a chave vir sozinha.'
  }
})

const escapar = texto => texto.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))

$('buscar').addEventListener('click', () => {
  const fileKey = $('chave').value.trim()
  const id = $('id').value.trim()

  saida.innerHTML = ''
  $('buscar').disabled = true

  chrome.runtime.sendMessage(
    { tipo: 'exportar', fileKey, pedidos: [{ chave: 't', id, raiz: id, caminho: [] }], escala: 1 },
    resposta => {
      $('buscar').disabled = false

      const erro = chrome.runtime.lastError
      if (erro) return mostrarErro(erro.message)
      if (!resposta?.ok) return mostrarErro(resposta?.erro ?? 'sem resposta')
      if (!resposta.imagens?.t) return mostrarErro(`nó não veio (faltaram: ${resposta.faltaram.join(', ') || 'nenhum'})`)

      saida.innerHTML = `<p>PNG em base64, ${resposta.imagens.t.length} caracteres.</p>`
    },
  )
})

function mostrarErro(mensagem) {
  saida.innerHTML = `<p class="erro">${escapar(String(mensagem))}</p>`
}
