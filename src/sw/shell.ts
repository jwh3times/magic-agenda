/**
 * The HTML shell as a navigation may receive it. Pure, so it is unit-tested; `src/sw.ts` cannot be.
 *
 * Cloudflare Pages answers `/index.html` with `308 -> /`, so the shell the worker precaches under
 * `/index.html` is a response that followed a redirect (`redirected: true`). A navigation's
 * redirect mode is `manual`, and answering it with a redirected response is a network error: with
 * the network down, every navigation failed with `net::ERR_FAILED` instead of opening the app
 * (#284). Copying the body, status and headers into a new `Response` drops the flag. The copy is
 * made on the way out as well as on the way in, because a device that installed an earlier worker
 * already holds the redirected copy, and the cache name does not change between workers.
 */
export function servableShell(response: Response): Response {
  if (!response.redirected) return response
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
