import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { createDemoClient, isDemoMode } from "@/lib/demo-db"

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (client) return client

  // Demo mode: no Supabase keys configured (or NEXT_PUBLIC_DEMO_MODE=1) – use the local in-browser store.
  if (isDemoMode()) {
    client = createDemoClient() as unknown as SupabaseClient
    return client
  }

  client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  return client
}
