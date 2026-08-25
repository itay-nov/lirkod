import type { Client } from "@/lib/db/client";

export async function findMyTickets(client: Client, userId: string) {
  const { data, error } = await client
    .from("tickets")
    .select(`
      id,
      status,
      issued_at,
      occurrence_id,
      event_occurrences!inner (
        starts_at,
        status,
        dance_events!inner (
          instructors (
            display_name
          ),
          venues!inner (
            name
          )
        ),
        override_venue:venues(name)
      )
    `)
    .eq("buyer_id", userId)
    .gte("event_occurrences.starts_at", new Date().toISOString())
    .order("issued_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function findMyPunchCards(client: Client, userId: string) {
  const { data, error } = await client
    .from("punch_cards")
    .select(`
      id,
      remaining_uses,
      total_uses,
      expires_at,
      status,
      instructors!inner (
        display_name
      )
    `)
    .eq("buyer_id", userId)
    .eq("status", "active")
    .order("issued_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function findMyCredits(client: Client, userId: string) {
  const { data, error } = await client
    .from("credits")
    .select(`
      id,
      remaining_agorot,
      amount_agorot,
      expires_at,
      status,
      refund_requested_at,
      instructor_id,
      instructors!inner (
        display_name
      )
    `)
    .eq("buyer_id", userId)
    .in("status", ["active", "expired"])
    .order("expires_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data;
}

export async function redeemCredit(client: Client, creditId: string, occurrenceId: string) {
  const { data, error } = await client.rpc("redeem_credit_for_ticket", {
    p_credit_id: creditId,
    p_occurrence_id: occurrenceId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function requestCreditRefund(client: Client, creditId: string) {
  const { data, error } = await client.rpc("request_credit_refund", {
    p_credit_id: creditId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function findUpcomingInstructorOccurrences(client: Client, instructorId: string, maxPriceAgorot: number) {
  const { data, error } = await client
    .from("event_occurrences")
    .select(`
      id,
      starts_at,
      status,
      dance_events!inner (
        instructor_id,
        price_agorot,
        venues!inner(name)
      ),
      override_venue:venues(name)
    `)
    .eq("dance_events.instructor_id", instructorId)
    .gt("dance_events.price_agorot", 0)
    .lte("dance_events.price_agorot", maxPriceAgorot)
    .neq("status", "cancelled")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(50);

  if (error) throw new Error(error.message);
  return data;
}

export type MyTicket = NonNullable<Awaited<ReturnType<typeof findMyTickets>>>[number];
export type MyPunchCard = NonNullable<Awaited<ReturnType<typeof findMyPunchCards>>>[number];
export type MyCredit = NonNullable<Awaited<ReturnType<typeof findMyCredits>>>[number];
export type UpcomingOccurrence = NonNullable<Awaited<ReturnType<typeof findUpcomingInstructorOccurrences>>>[number];

export type MyCreditWithOccurrences = MyCredit & {
  occurrences: UpcomingOccurrence[];
};
