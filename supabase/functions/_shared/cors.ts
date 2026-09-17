/**
 * CORS headers for browser-invoked functions. The app origin varies
 * (production, Pages previews, localhost), so allow any origin — authorization
 * comes from the JWT, never from the origin.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
