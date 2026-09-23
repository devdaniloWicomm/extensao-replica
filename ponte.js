/**
 * Recado entre a página do editor e a extensão.
 *
 * Este arquivo roda no "mundo isolado": mesmo DOM da página, variáveis separadas.
 * A página não enxerga nada daqui além do que é postado de volta, e não tem como
 * chamar a extensão por fora — o manifesto já limita em quais origens este script
 * é injetado, e é essa a barreira, imposta pelo navegador e não por nós.
 *
 * Optamos por este caminho em vez de `externally_connectable` porque o Chrome exige
 * domínio de segundo nível naquela lista, o que deixaria o `localhost` de fora — e
 * porque assim a página não precisa saber o identificador da extensão, que muda
 * conforme a pasta em instalação por modo desenvolvedor.
 */

const DA_PAGINA = 'gerador-emails'
const DA_PONTE = 'ponte-figma'

function responder(id, carga) {
  window.postMessage({ de: DA_PONTE, id, ...carga }, window.location.origin)
}

window.addEventListener('message', evento => {
  // A barreira é a origem, e ela basta: o manifesto já limita em quais origens este
  // script é injetado, e o único iframe da nossa página é o da prévia, com
  // `sandbox=""` — origem opaca, que nunca casa com a nossa.
  //
  // Não comparamos `evento.source` com `window`: script de conteúdo roda em mundo
  // isolado, e a identidade do objeto entre os dois mundos é justamente o tipo de
  // detalhe que faz a mensagem ser descartada em silêncio.
  if (evento.origin !== window.location.origin) return

  const dados = evento.data
  if (!dados || dados.de !== DA_PAGINA || typeof dados.id !== 'string') return

  const pedido =
    dados.tipo === 'ping'
      ? { tipo: 'ping' }
      : dados.tipo === 'exportar'
        ? { tipo: 'exportar', fileKey: dados.fileKey, pedidos: dados.pedidos, escala: dados.escala }
        : null

  if (!pedido) return responder(dados.id, { ok: false, erro: `pedido desconhecido: ${dados.tipo}` })

  chrome.runtime.sendMessage(pedido, resposta => {
    // A extensão pode ter sido recarregada no meio do caminho — em instalação por
    // modo desenvolvedor isso acontece toda hora, e sem este ramo a página fica
    // esperando para sempre.
    const erro = chrome.runtime.lastError
    if (erro) return responder(dados.id, { ok: false, erro: `ponte indisponível: ${erro.message}` })
    responder(dados.id, resposta ?? { ok: false, erro: 'ponte não respondeu' })
  })
})

// Aviso de chegada: a página escuta isto para saber que a ponte existe, sem precisar
// perguntar e esperar o tempo limite. Quem carregar depois usa o `ping`.
const versao = chrome.runtime.getManifest().version
window.postMessage({ de: DA_PONTE, tipo: 'pronta', versao }, window.location.origin)

// Rastro no console da página: quando a colagem não traz imagem, a primeira
// pergunta é "a extensão está mesmo nesta aba?" — e sem isto não havia como
// responder sem abrir o inspetor da própria extensão.
console.info(`[ponte-figma] injetada nesta página, versão ${versao}`)
