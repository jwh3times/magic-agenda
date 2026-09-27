;(function () {
  const redemptionPaths = ['/auth/reset', '/auth/confirm']
  let tokenHash = null
  let invitationToken = null

  if (redemptionPaths.includes(window.location.pathname)) {
    tokenHash = new URLSearchParams(window.location.search).get('token_hash') || null
    window.history.replaceState(window.history.state, '', window.location.pathname)
  }

  // A Board Invitation link (#437). Same scrub, same reason: the token must leave the address bar
  // before anything else on the page can read the URL. It is not an auth token and never
  // establishes a session; the app moves it from here into its own pending-invitation storage.
  if (window.location.pathname === '/invite') {
    invitationToken = new URLSearchParams(window.location.search).get('token') || null
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

  Object.defineProperty(window, '__magicAgendaInvitationCapture', {
    configurable: true,
    value: Object.freeze({
      read: function () {
        return invitationToken
      },
      consume: function () {
        invitationToken = null
      },
    }),
  })
})()
