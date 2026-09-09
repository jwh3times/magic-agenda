import { supabase } from '../lib/supabase'
import { useLiveAccess } from './useLiveAccess'

export interface FeatureFlag {
  key: string
  enabled: boolean
  description: string
}
const NO_FLAGS: FeatureFlag[] = []

async function readFlags(): Promise<FeatureFlag[]> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, enabled, description')
    .order('key')
  if (error) throw error
  return data ?? []
}

/** Missing flags, unavailable reads, signed-out sessions and offline mode all disable gates. */
export function useFlags() {
  const { value: flags, ...state } = useLiveAccess(readFlags, NO_FLAGS)
  return {
    flags,
    isEnabled: (key: string) => flags.some((flag) => flag.key === key && flag.enabled),
    ...state,
  }
}
