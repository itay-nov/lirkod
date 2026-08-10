import Image from "next/image";
import { he } from "@/lib/i18n/he";

/**
 * The "Powered by Google" mark that has to appear beside Places predictions.
 *
 * Not decoration and not optional. Google's Places policy requires this
 * attribution wherever Places data is displayed on a surface that does NOT also
 * show a Google map — which is exactly our case: the venue picker renders
 * predictions as a plain list, with no map anywhere on /profile.
 *
 * The asset is Google's own, taken from `maps.gstatic.com` and vendored into
 * `public/`. Vendored rather than hotlinked so the form does not depend on a
 * third-party request to stay compliant, and rather than redrawn, because
 * reproducing the wordmark by hand would mean approximating someone else's
 * trademark — the approved file is the approved file.
 *
 * It is the 2x file (240x28) rendered at its 1x size, so it stays sharp on a
 * phone's high-density screen without needing a srcSet `next/image` would
 * override anyway. The extra two kilobytes buy that.
 *
 * It is the "on white" variant, which is the one Google specifies for light
 * backgrounds; ours is `--color-surface`, a warm off-white. The PNG carries an
 * alpha channel, so it composites onto that paper rather than sitting in a white
 * box.
 *
 * **Sizing is Google's decision, not ours.** 120x14 is the asset's native size
 * and its documented minimum, so this is the one place in the app that does not
 * scale with the user's text size — AGENTS.md §2.5's 18px floor is about text we
 * author, and shrinking or stretching this mark would break the brand
 * requirement it exists to satisfy. The clear space around it is the `py-3`
 * below.
 */
export function GoogleAttribution() {
  return (
    <div className="flex justify-start py-3">
      <Image
        src="/powered-by-google-on-white.png"
        width={120}
        height={14}
        // The mark is the attribution, so it carries meaning and must not be
        // hidden from assistive tech with an empty alt.
        alt={he.publishDance.poweredByGoogle}
        unoptimized
      />
    </div>
  );
}
