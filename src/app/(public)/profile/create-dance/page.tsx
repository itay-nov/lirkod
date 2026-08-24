import { redirect } from "next/navigation";
import { CreateDanceForm } from "@/components/CreateDanceForm";
import { ProfileNavDrawer } from "@/components/ProfileNavDrawer";
import { currentUser } from "@/lib/auth/session";
import { serverClient } from "@/lib/auth/serverClient";
import { findOwnInstructor, findOwnProfile } from "@/lib/db/publisher";
import { findRecentOwnVenues, searchVenues } from "@/lib/db/venues";
import { roleFor, showsInstructorTools } from "@/lib/domain/role";
import { he } from "@/lib/i18n/he";

export default async function CreateDancePage() {
  const user = await currentUser();
  if (user === null) redirect("/profile");

  const client = await serverClient();
  const profile = await findOwnProfile(client, user.id);
  if (profile === null) redirect("/profile");

  const instructor = await findOwnInstructor(client, profile.id);
  const role = roleFor(instructor);
  if (!showsInstructorTools(role) || instructor === null) redirect("/profile");

  const [venues, recentVenues] = await Promise.all([
    searchVenues(client, ""),
    findRecentOwnVenues(client, instructor.id),
  ]);

  return (
    <div className="relative px-4 py-6">
      <ProfileNavDrawer role={role} />
      <h1 className="font-display text-3xl font-black">{he.profileMenu.createDance}</h1>
      <CreateDanceForm
        venues={venues}
        recentVenues={recentVenues}
        mapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null}
        instructorName={instructor.displayName}
        needsInstructorName={false}
      />
    </div>
  );
}
