export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_profiles: {
        Row: {
          account_id: string
          created_at: string
          display_name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          display_name?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          display_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      board_memberships: {
        Row: {
          account_id: string | null
          board_id: string
          created_at: string
          default_view: string
          end_reason: string | null
          ended_at: string | null
          id: string
          joined_at: string
          role: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          board_id: string
          created_at?: string
          default_view?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          joined_at?: string
          role: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          board_id?: string
          created_at?: string
          default_view?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          joined_at?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'board_memberships_board_id_fkey'
            columns: ['board_id']
            isOneToOne: false
            referencedRelation: 'boards'
            referencedColumns: ['id']
          },
        ]
      }
      boards: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      labels: {
        Row: {
          board_id: string
          created_at: string
          dot_color: string
          id: string
          legacy_category: string | null
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          board_id: string
          created_at?: string
          dot_color: string
          id?: string
          legacy_category?: string | null
          name: string
          position: number
          updated_at?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          dot_color?: string
          id?: string
          legacy_category?: string | null
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'labels_board_id_fkey'
            columns: ['board_id']
            isOneToOne: false
            referencedRelation: 'boards'
            referencedColumns: ['id']
          },
        ]
      }
      tasks: {
        Row: {
          at_time: string | null
          author_id: string | null
          author_kind: string
          board_id: string
          category: string
          checklist: Json
          color: string
          created_at: string
          day: string | null
          description: string
          id: string
          korder: number
          label_assignment_explicit: boolean
          label_id: string | null
          last_editor_id: string | null
          order_index: number
          pinned: boolean
          recur_freq: string
          recur_interval: number
          recur_origin_day: string | null
          recur_parent_id: string | null
          recur_skip: Json
          recur_until: string | null
          revision: number
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          at_time?: string | null
          author_id?: string | null
          author_kind?: string
          board_id: string
          category?: string
          checklist?: Json
          color?: string
          created_at?: string
          day?: string | null
          description?: string
          id?: string
          korder?: number
          label_assignment_explicit?: boolean
          label_id?: string | null
          last_editor_id?: string | null
          order_index?: number
          pinned?: boolean
          recur_freq?: string
          recur_interval?: number
          recur_origin_day?: string | null
          recur_parent_id?: string | null
          recur_skip?: Json
          recur_until?: string | null
          revision?: number
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          at_time?: string | null
          author_id?: string | null
          author_kind?: string
          board_id?: string
          category?: string
          checklist?: Json
          color?: string
          created_at?: string
          day?: string | null
          description?: string
          id?: string
          korder?: number
          label_assignment_explicit?: boolean
          label_id?: string | null
          last_editor_id?: string | null
          order_index?: number
          pinned?: boolean
          recur_freq?: string
          recur_interval?: number
          recur_origin_day?: string | null
          recur_parent_id?: string | null
          recur_skip?: Json
          recur_until?: string | null
          revision?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_board_id_fkey'
            columns: ['board_id']
            isOneToOne: false
            referencedRelation: 'boards'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_label_same_board'
            columns: ['board_id', 'label_id']
            isOneToOne: false
            referencedRelation: 'labels'
            referencedColumns: ['board_id', 'id']
          },
          {
            foreignKeyName: 'tasks_recur_parent_same_board'
            columns: ['board_id', 'recur_parent_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['board_id', 'id']
          },
        ]
      }
      user_settings: {
        Row: {
          default_view: string
          theme: string
          timezone: string | null
          updated_at: string
          user_id: string
          week_start: number
        }
        Insert: {
          default_view?: string
          theme?: string
          timezone?: string | null
          updated_at?: string
          user_id: string
          week_start?: number
        }
        Update: {
          default_view?: string
          theme?: string
          timezone?: string | null
          updated_at?: string
          user_id?: string
          week_start?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_board: { Args: { board_name: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
