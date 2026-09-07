# Canonical production host

Production uses `https://magicagenda.app`. Cloudflare account-level Bulk Redirects send
`www.magicagenda.app` and the bare `magic-agenda.pages.dev` alias there with HTTP 301, preserving
paths and query strings. Preview hosts such as `<deployment>.magic-agenda.pages.dev` still serve
that deployment directly. A visitor previously signed in on an alias may need to sign in again on
the apex: browser sessions and offline snapshots are origin-scoped and are not transferred.
Already-open or offline cached tabs are not remotely cleared by an edge redirect; these rules
apply when a request reaches Cloudflare.

## Configuration

The desired redirect items are recorded in
[production-redirects.json](../cloudflare/production-redirects.json). The live configuration is
managed through Cloudflare Bulk Redirects; changing this file alone does not deploy it.

1. Find or create the account-level redirect list `magic_agenda_canonical` (kind `redirect`).
2. Apply the two items from the JSON file and wait for the list's bulk operation to complete.
3. Enable that list with an account-level `http_request_redirect` rule:
   `http.request.full_uri in $magic_agenda_canonical`, action `redirect`, and
   `action_parameters.from_list = {"name":"magic_agenda_canonical","key":"http.request.full_uri"}`.
   Preserve any unrelated rules in the entry-point ruleset.

**Keep `include_subdomains` false.** Enabling it on the Pages alias also redirects every preview,
which makes preview tests exercise production instead of the proposed change. Do not put a
hostname rule in `public/_redirects`: Pages supports path-based rules there; the SPA rewrite
remains `/* /index.html 200`.

## Verify and roll back

Run against a known successful deployment preview:

```bash
node scripts/check-canonical-hosts.mjs https://DEPLOYMENT.magic-agenda.pages.dev
```

The checker uses HEAD requests and synthetic auth values. It checks both aliases, path/query
preservation, the apex, and the preview. Never substitute real authentication tokens.
To roll back, disable only the rule referencing `magic_agenda_canonical`. Previously cached 301s
may remain in browsers; verify from a fresh HTTP client. No DNS or auth allow-list changes are
needed for this configuration.

References: [www redirects](https://developers.cloudflare.com/pages/how-to/www-redirect/),
[Pages alias redirects](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/),
[Bulk Redirects API](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/create-api/).
