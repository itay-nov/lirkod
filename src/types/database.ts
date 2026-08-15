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
          recurrence_freq: Database["public"]["Enums"]["recurrence_freq"] | null
          recurrence_local_end_time: string | null
          recurrence_local_start_time: string | null
          recurrence_rule: string | null
          recurrence_start_date: string | null
          recurrence_until_date: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string
          dance_types?: string[]
          id?: string
          instructor_id: string
          price_agorot: number
          recurrence_freq?:
            | Database["public"]["Enums"]["recurrence_freq"]
            | null
          recurrence_local_end_time?: string | null
          recurrence_local_start_time?: string | null
          recurrence_rule?: string | null
          recurrence_start_date?: string | null
          recurrence_until_date?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string
          dance_types?: string[]
          id?: string
          instructor_id?: string
          price_agorot?: number
          recurrence_freq?:
            | Database["public"]["Enums"]["recurrence_freq"]
            | null
          recurrence_local_end_time?: string | null
          recurrence_local_start_time?: string | null
          recurrence_rule?: string | null
          recurrence_start_date?: string | null
          recurrence_until_date?: string | null
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
          original_starts_at: string | null
          overridden_at: string | null
          override_venue_id: string | null
          series_date: string | null
          starts_at: string
          status: Database["public"]["Enums"]["occurrence_status"]
        }
        Insert: {
          cancellation_reason?: string | null
          created_at?: string
          ends_at: string
          event_id: string
          id?: string
          original_starts_at?: string | null
          overridden_at?: string | null
          override_venue_id?: string | null
          series_date?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["occurrence_status"]
        }
        Update: {
          cancellation_reason?: string | null
          created_at?: string
          ends_at?: string
          event_id?: string
          id?: string
          original_starts_at?: string | null
          overridden_at?: string | null
          override_venue_id?: string | null
          series_date?: string | null
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
          avatar_id: Database["public"]["Enums"]["avatar_choice"]
          created_at: string
          display_name: string
          home_location: unknown
          id: string
          phone: string
        }
        Insert: {
          avatar_id?: Database["public"]["Enums"]["avatar_choice"]
          created_at?: string
          display_name: string
          home_location?: unknown
          id: string
          phone: string
        }
        Update: {
          avatar_id?: Database["public"]["Enums"]["avatar_choice"]
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
          place_id: string | null
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
          place_id?: string | null
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
          place_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      find_dances_near: {
        Args: { p_lat: number; p_lng: number; p_radius_meters: number }
        Returns: {
          dance_types: string[]
          instructor_display_name: string
          occurrence_id: string
          original_starts_at: string
          price_agorot: number
          starts_at: string
          status: Database["public"]["Enums"]["occurrence_status"]
          venue_id: string
          venue_lat: number
          venue_lng: number
          venue_name: string
        }[]
      }
      find_or_create_venue: {
        Args: {
          p_address: string
          p_lat: number
          p_lng: number
          p_name: string
          p_place_id: string
        }
        Returns: {
          address: string
          id: string
          name: string
        }[]
      }
      generate_occurrences: { Args: never; Returns: number }
      generate_occurrences_for_event: {
        Args: { p_event_id: string; p_horizon_days?: number }
        Returns: number
      }
      owns_event: { Args: { p_event_id: string }; Returns: boolean }
      owns_instructor: { Args: { p_instructor_id: string }; Returns: boolean }
      publish_dance: {
        Args: {
          p_ends_at: string
          p_instructor_id: string
          p_starts_at: string
          p_venue_id: string
        }
        Returns: {
          event_id: string
          occurrence_id: string
        }[]
      }
      publish_recurring_dance: {
        Args: {
          p_freq: Database["public"]["Enums"]["recurrence_freq"]
          p_instructor_id: string
          p_local_end_time: string
          p_local_start_time: string
          p_start_date: string
          p_until_date?: string
          p_venue_id: string
        }
        Returns: {
          event_id: string
          occurrence_count: number
        }[]
      }
    }
    Enums: {
      avatar_choice:
        | "woman_short_hair"
        | "man_curly"
        | "woman_long_hair"
        | "man_glasses"
        | "woman_gray_bun"
        | "man_bald_mustache"
        | "woman_curly_gray"
        | "man_gray_beard"
        | "dancer_figure"
        | "circle_dance"
        | "pomegranate"
        | "musical_notes"
      occurrence_status: "scheduled" | "cancelled" | "moved"
      recurrence_freq: "weekly" | "biweekly"
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
      avatar_choice: [
        "woman_short_hair",
        "man_curly",
        "woman_long_hair",
        "man_glasses",
        "woman_gray_bun",
        "man_bald_mustache",
        "woman_curly_gray",
        "man_gray_beard",
        "dancer_figure",
        "circle_dance",
        "pomegranate",
        "musical_notes",
      ],
      occurrence_status: ["scheduled", "cancelled", "moved"],
      recurrence_freq: ["weekly", "biweekly"],
    },
  },
} as const

