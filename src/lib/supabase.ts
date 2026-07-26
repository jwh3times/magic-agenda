import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.',
  )
}

/** Typed Supabase singleton. The anon key is public by design; safety comes from RLS. */
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce',
    // Never adopt implicit-grant tokens from a URL fragment: that path has no
    // state/nonce binding and is the session-fixation vector. Email links now
    // carry ?token_hash= and are redeemed explicitly via verifyOtp().
    detectSessionInUrl: () => false,
  },
})
