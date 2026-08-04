export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      dance_events: {
        Row: {
          created_at: string
          dance_types: string[]
          id: string
          instructor_id: string
          price_agorot: number
          recurrence_rule: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string
          dance_types?: string[]
          id?: string
          instructor_id: string
          price_agorot: number
          recurrence_rule?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string
          dance_types?: string[]
          id?: string
          instructor_id?: string
          price_agorot?: number
          recurrence_rule?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dance_events_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "instructors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dance_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_occurrences: {
        Row: {
          cancellation_reason: string | null
          created_at: string
          ends_at: string
          event_id: string
          id: string
          overridden_at: string | null
          override_venue_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["occurrence_status"]
        }
        Insert: {
          cancellation_reason?: string | null
          created_at?: string
          ends_at: string
          event_id: string
          id?: string
          overridden_at?: string | null
          override_venue_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["occurrence_status"]
        }
        Update: {
          cancellation_reason?: string | null
          created_at?: string
          ends_at?: string
          event_id?: string
          id?: string
          overridden_at?: string | null
          override_venue_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["occurrence_status"]
        }
        Relationships: [
          {
            foreignKeyName: "event_occurrences_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "dance_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_occurrences_override_venue_id_fkey"
            columns: ["override_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      instructors: {
        Row: {
          bio: string | null
          created_at: string
          display_name: string
          id: string
          profile_id: string
          verified: boolean
        }
        Insert: {
          bio?: string | null
          created_at?: string
          display_name: string
          id?: string
          profile_id: string
          verified?: boolean
        }
        Update: {
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          profile_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "instructors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          home_location: unknown
          id: string
          phone: string
        }
        Insert: {
          created_at?: string
          display_name: string
          home_location?: unknown
          id: string
          phone: string
        }
        Update: {
          created_at?: string
          display_name?: string
          home_location?: unknown
          id?: string
          phone?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          address: string
          capacity: number | null
          created_at: string
          has_ac: boolean | null
          has_parking: boolean | null
          id: string
          is_accessible: boolean | null
          location: unknown
          name: string
        }
        Insert: {
          address: string
          capacity?: number | null
          created_at?: string
          has_ac?: boolean | null
          has_parking?: boolean | null
          id?: string
          is_accessible?: boolean | null
          location: unknown
          name: string
        }
        Update: {
          address?: string
          capacity?: number | null
          created_at?: string
          has_ac?: boolean | null
          has_parking?: boolean | null
          id?: string
          is_accessible?: boolean | null
          location?: unknown
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      owns_event: { Args: { p_event_id: string }; Returns: boolean }
      owns_instructor: { Args: { p_instructor_id: string }; Returns: boolean }
    }
    Enums: {
      occurrence_status: "scheduled" | "cancelled" | "moved"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      occurrence_status: ["scheduled", "cancelled", "moved"],
    },
  },
} as const

