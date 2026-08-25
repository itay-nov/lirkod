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
      credits: {
        Row: {
          amount_agorot: number
          buyer_id: string
          expires_at: string
          id: string
          instructor_id: string
          issued_at: string
          refund_requested_at: string | null
          remaining_agorot: number
          source_order_id: string
          source_ticket_id: string | null
          status: Database["public"]["Enums"]["credit_status"]
        }
        Insert: {
          amount_agorot: number
          buyer_id: string
          expires_at?: string
          id?: string
          instructor_id: string
          issued_at?: string
          refund_requested_at?: string | null
          remaining_agorot: number
          source_order_id: string
          source_ticket_id?: string | null
          status?: Database["public"]["Enums"]["credit_status"]
        }
        Update: {
          amount_agorot?: number
          buyer_id?: string
          expires_at?: string
          id?: string
          instructor_id?: string
          issued_at?: string
          refund_requested_at?: string | null
          remaining_agorot?: number
          source_order_id?: string
          source_ticket_id?: string | null
          status?: Database["public"]["Enums"]["credit_status"]
        }
        Relationships: [
          {
            foreignKeyName: "credits_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "instructors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_source_order_buyer_fkey"
            columns: ["source_order_id", "buyer_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "buyer_id"]
          },
          {
            foreignKeyName: "credits_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_source_order_instructor_fkey"
            columns: ["source_order_id", "instructor_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "instructor_id"]
          },
          {
            foreignKeyName: "credits_source_ticket_buyer_fkey"
            columns: ["source_ticket_id", "buyer_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id", "buyer_id"]
          },
          {
            foreignKeyName: "credits_source_ticket_id_fkey"
            columns: ["source_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      dance_events: {
        Row: {
          created_at: string
          dance_formations: Database["public"]["Enums"]["dance_formation"][]
          dance_types: string[]
          flyer_path: string | null
          id: string
          instructor_id: string
          level: Database["public"]["Enums"]["dance_level"]
          price_agorot: number
          recurrence_freq: Database["public"]["Enums"]["recurrence_freq"] | null
          recurrence_local_end_time: string | null
          recurrence_local_start_time: string | null
          recurrence_rule: string | null
          recurrence_start_date: string | null
          recurrence_until_date: string | null
          venue_id: string
          women_only: boolean
        }
        Insert: {
          created_at?: string
          dance_formations?: Database["public"]["Enums"]["dance_formation"][]
          dance_types?: string[]
          flyer_path?: string | null
          id?: string
          instructor_id: string
          level?: Database["public"]["Enums"]["dance_level"]
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
          women_only?: boolean
        }
        Update: {
          created_at?: string
          dance_formations?: Database["public"]["Enums"]["dance_formation"][]
          dance_types?: string[]
          flyer_path?: string | null
          id?: string
          instructor_id?: string
          level?: Database["public"]["Enums"]["dance_level"]
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
          women_only?: boolean
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
      favorites: {
        Row: {
          created_at: string
          event_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "dance_events"
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
      orders: {
        Row: {
          applied_credit_id: string | null
          buyer_id: string
          charged_amount_agorot: number | null
          created_at: string
          credit_applied_agorot: number
          gross_amount_agorot: number
          id: string
          instructor_id: string
          instructor_payout_agorot: number | null
          kind: Database["public"]["Enums"]["order_kind"]
          platform_fee_agorot: number
          provider_confirmed_at: string | null
          provider_fee_agorot: number
          provider_transaction_id: string | null
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          applied_credit_id?: string | null
          buyer_id: string
          charged_amount_agorot?: number | null
          created_at?: string
          credit_applied_agorot?: number
          gross_amount_agorot: number
          id?: string
          instructor_id: string
          instructor_payout_agorot?: number | null
          kind: Database["public"]["Enums"]["order_kind"]
          platform_fee_agorot?: number
          provider_confirmed_at?: string | null
          provider_fee_agorot?: number
          provider_transaction_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          applied_credit_id?: string | null
          buyer_id?: string
          charged_amount_agorot?: number | null
          created_at?: string
          credit_applied_agorot?: number
          gross_amount_agorot?: number
          id?: string
          instructor_id?: string
          instructor_payout_agorot?: number | null
          kind?: Database["public"]["Enums"]["order_kind"]
          platform_fee_agorot?: number
          provider_confirmed_at?: string | null
          provider_fee_agorot?: number
          provider_transaction_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "orders_applied_credit_fkey"
            columns: ["applied_credit_id", "buyer_id", "instructor_id"]
            isOneToOne: false
            referencedRelation: "credits"
            referencedColumns: ["id", "buyer_id", "instructor_id"]
          },
          {
            foreignKeyName: "orders_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "instructors"
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
      punch_cards: {
        Row: {
          buyer_id: string
          expires_at: string | null
          id: string
          instructor_id: string
          issued_at: string
          order_id: string
          remaining_uses: number
          status: Database["public"]["Enums"]["punch_card_status"]
          total_uses: number
        }
        Insert: {
          buyer_id: string
          expires_at?: string | null
          id?: string
          instructor_id: string
          issued_at?: string
          order_id: string
          remaining_uses: number
          status?: Database["public"]["Enums"]["punch_card_status"]
          total_uses: number
        }
        Update: {
          buyer_id?: string
          expires_at?: string | null
          id?: string
          instructor_id?: string
          issued_at?: string
          order_id?: string
          remaining_uses?: number
          status?: Database["public"]["Enums"]["punch_card_status"]
          total_uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "punch_cards_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "instructors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_cards_order_buyer_fkey"
            columns: ["order_id", "buyer_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "buyer_id"]
          },
          {
            foreignKeyName: "punch_cards_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_cards_order_instructor_fkey"
            columns: ["order_id", "instructor_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "instructor_id"]
          },
        ]
      }
      sponsored_promotions: {
        Row: {
          area: string
          cancelled_at: string | null
          created_at: string
          ends_at: string
          event_id: string
          id: string
          instructor_id: string
          order_id: string
          starts_at: string
        }
        Insert: {
          area: string
          cancelled_at?: string | null
          created_at?: string
          ends_at: string
          event_id: string
          id?: string
          instructor_id: string
          order_id: string
          starts_at: string
        }
        Update: {
          area?: string
          cancelled_at?: string | null
          created_at?: string
          ends_at?: string
          event_id?: string
          id?: string
          instructor_id?: string
          order_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsored_promotions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "dance_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsored_promotions_event_instructor_fkey"
            columns: ["event_id", "instructor_id"]
            isOneToOne: false
            referencedRelation: "dance_events"
            referencedColumns: ["id", "instructor_id"]
          },
          {
            foreignKeyName: "sponsored_promotions_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "instructors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsored_promotions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsored_promotions_order_instructor_fkey"
            columns: ["order_id", "instructor_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "instructor_id"]
          },
        ]
      }
      tickets: {
        Row: {
          buyer_id: string
          id: string
          issued_at: string
          occurrence_id: string
          order_id: string | null
          punch_card_id: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          used_at: string | null
        }
        Insert: {
          buyer_id: string
          id?: string
          issued_at?: string
          occurrence_id: string
          order_id?: string | null
          punch_card_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          used_at?: string | null
        }
        Update: {
          buyer_id?: string
          id?: string
          issued_at?: string
          occurrence_id?: string
          order_id?: string | null
          punch_card_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "event_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_buyer_fkey"
            columns: ["order_id", "buyer_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "buyer_id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_punch_card_buyer_fkey"
            columns: ["punch_card_id", "buyer_id"]
            isOneToOne: false
            referencedRelation: "punch_cards"
            referencedColumns: ["id", "buyer_id"]
          },
          {
            foreignKeyName: "tickets_punch_card_id_fkey"
            columns: ["punch_card_id"]
            isOneToOne: false
            referencedRelation: "punch_cards"
            referencedColumns: ["id"]
          },
        ]
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
          dance_formations: Database["public"]["Enums"]["dance_formation"][]
          dance_types: string[]
          event_id: string
          instructor_display_name: string
          level: Database["public"]["Enums"]["dance_level"]
          occurrence_id: string
          original_starts_at: string
          price_agorot: number
          starts_at: string
          status: Database["public"]["Enums"]["occurrence_status"]
          venue_id: string
          venue_lat: number
          venue_lng: number
          venue_name: string
          women_only: boolean
        }[]
      }
      find_favorite_nights: {
        Args: { p_event_ids: string[] }
        Returns: {
          dance_formations: Database["public"]["Enums"]["dance_formation"][]
          dance_types: string[]
          event_id: string
          instructor_display_name: string
          level: Database["public"]["Enums"]["dance_level"]
          occurrence_id: string
          original_starts_at: string
          price_agorot: number
          starts_at: string
          status: Database["public"]["Enums"]["occurrence_status"]
          venue_id: string
          venue_lat: number
          venue_lng: number
          venue_name: string
          women_only: boolean
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
      get_active_promoted_event_ids: {
        Args: { p_area?: string }
        Returns: {
          event_id: string
        }[]
      }
      move_occurrence_venue: {
        Args: { p_occurrence_id: string; p_venue_id: string }
        Returns: {
          occurrence_id: string
        }[]
      }
      owns_event: { Args: { p_event_id: string }; Returns: boolean }
      owns_instructor: { Args: { p_instructor_id: string }; Returns: boolean }
      owns_occurrence: { Args: { p_occurrence_id: string }; Returns: boolean }
      publish_dance: {
        Args: {
          p_dance_formations?: Database["public"]["Enums"]["dance_formation"][]
          p_ends_at: string
          p_instructor_id: string
          p_level?: Database["public"]["Enums"]["dance_level"]
          p_starts_at: string
          p_venue_id: string
          p_women_only?: boolean
        }
        Returns: {
          event_id: string
          occurrence_id: string
        }[]
      }
      publish_recurring_dance: {
        Args: {
          p_dance_formations?: Database["public"]["Enums"]["dance_formation"][]
          p_freq: Database["public"]["Enums"]["recurrence_freq"]
          p_instructor_id: string
          p_level?: Database["public"]["Enums"]["dance_level"]
          p_local_end_time: string
          p_local_start_time: string
          p_start_date: string
          p_until_date?: string
          p_venue_id: string
          p_women_only?: boolean
        }
        Returns: {
          event_id: string
          occurrence_count: number
        }[]
      }
      redeem_credit_for_ticket: {
        Args: { p_credit_id: string; p_occurrence_id: string }
        Returns: {
          credit_applied_agorot: number
          credit_remaining_agorot: number
          order_id: string
          ticket_id: string
        }[]
      }
      request_credit_refund: {
        Args: { p_credit_id: string }
        Returns: {
          credit_id: string
          instructor_absorbed_fee_agorot: number
          refund_amount_agorot: number
          requested_at: string
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
      credit_status: "active" | "redeemed" | "expired" | "refunded"
      dance_formation: "circle" | "couples" | "line" | "mixed"
      dance_level: "beginner" | "intermediate" | "advanced" | "all_levels"
      occurrence_status: "scheduled" | "cancelled" | "moved"
      order_kind: "ticket" | "punch_card" | "sponsored_promotion"
      order_status:
        | "pending_provider_confirmation"
        | "paid"
        | "failed"
        | "cancelled"
        | "refunded"
      punch_card_status: "active" | "exhausted" | "expired" | "cancelled"
      recurrence_freq: "weekly" | "biweekly"
      ticket_status: "valid" | "used" | "cancelled" | "credited"
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
      credit_status: ["active", "redeemed", "expired", "refunded"],
      dance_formation: ["circle", "couples", "line", "mixed"],
      dance_level: ["beginner", "intermediate", "advanced", "all_levels"],
      occurrence_status: ["scheduled", "cancelled", "moved"],
      order_kind: ["ticket", "punch_card", "sponsored_promotion"],
      order_status: [
        "pending_provider_confirmation",
        "paid",
        "failed",
        "cancelled",
        "refunded",
      ],
      punch_card_status: ["active", "exhausted", "expired", "cancelled"],
      recurrence_freq: ["weekly", "biweekly"],
      ticket_status: ["valid", "used", "cancelled", "credited"],
    },
  },
} as const

