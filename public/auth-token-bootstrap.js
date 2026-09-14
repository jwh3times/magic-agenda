;(function () {
  const redemptionPaths = ['/auth/reset', '/auth/confirm']
  let tokenHash = null

  if (redemptionPaths.includes(window.location.pathname)) {
    tokenHash = new URLSearchParams(window.location.search).get('token_hash') || null
    window.history.replaceState(window.history.state, '', window.location.pathname)
  }

  Object.defineProperty(window, '__magicAgendaAuthTokenCapture', {
    configurable: true,
    value: Object.freeze({
      read: function () {
        return tokenHash
      },
      consume: function () {
        tokenHash = null
      },
    }),
  })
})()
