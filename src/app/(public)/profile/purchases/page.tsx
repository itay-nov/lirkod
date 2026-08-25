import { redirect } from "next/navigation";
import { serverClient } from "@/lib/auth/serverClient";
import { findMyTickets, findMyPunchCards, findMyCredits, findUpcomingInstructorOccurrences } from "@/lib/db/purchases";
import { he } from "@/lib/i18n/he";
import { PurchasesList } from "./PurchasesList";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const client = await serverClient();
  const { data: userResponse, error: authError } = await client.auth.getUser();
  
  if (authError || !userResponse?.user) {
    redirect("/profile");
  }

  const [tickets, punchCards, credits] = await Promise.all([
    findMyTickets(client, userResponse.user.id),
    findMyPunchCards(client, userResponse.user.id),
    findMyCredits(client, userResponse.user.id),
  ]);

  // For the credits, we need to fetch the eligible upcoming occurrences for their respective instructors
  const creditsWithOccurrences = await Promise.all(
    credits.map(async (credit) => {
      const occurrences = await findUpcomingInstructorOccurrences(client, credit.instructor_id, credit.remaining_agorot);
      return {
        ...credit,
        occurrences,
      };
    })
  );

  return (
    <div className="flex flex-col gap-8 px-4 pb-12 pt-8">
      <h1 className="font-display text-3xl font-black">{he.purchases.heading}</h1>
      <PurchasesList 
        tickets={tickets} 
        punchCards={punchCards} 
        credits={creditsWithOccurrences} 
      />
    </div>
  );
}
