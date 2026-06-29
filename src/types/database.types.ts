// Hand-written to match supabase/migrations/20260629120000_init.sql.
// Regenerate exactly with: supabase gen types typescript --linked > src/types/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      tasks: {
        Row: {
          id: string
          user_id: string
          title: string
          description: string
          category: string
          color: string
          checklist: Json
          status: string
          day: string | null
          order_index: number
          korder: number
          recur_freq: string
          recur_interval: number
          recur_until: string | null
          recur_parent_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title?: string
          description?: string
          category?: string
          color?: string
          checklist?: Json
          status?: string
          day?: string | null
          order_index?: number
          korder?: number
          recur_freq?: string
          recur_interval?: number
          recur_until?: string | null
          recur_parent_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          description?: string
          category?: string
          color?: string
          checklist?: Json
          status?: string
          day?: string | null
          order_index?: number
          korder?: number
          recur_freq?: string
          recur_interval?: number
          recur_until?: string | null
          recur_parent_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          user_id: string
          theme: string
          default_view: string
          updated_at: string
        }
        Insert: {
          user_id: string
          theme?: string
          default_view?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          theme?: string
          default_view?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type TaskRow = Database['public']['Tables']['tasks']['Row']
export type TaskInsert = Database['public']['Tables']['tasks']['Insert']
export type TaskUpdate = Database['public']['Tables']['tasks']['Update']
export type SettingsRow = Database['public']['Tables']['user_settings']['Row']
export type SettingsInsert = Database['public']['Tables']['user_settings']['Insert']
