import { AVATAR_IDS, type AvatarId } from "@/lib/domain/avatar";
import {
  ManBaldMustacheIcon,
  ManCurlyIcon,
  ManGlassesIcon,
  ManGrayBeardIcon,
  WomanCurlyGrayIcon,
  WomanGrayBunIcon,
  WomanLongHairIcon,
  WomanShortHairIcon,
} from "./avatars/avatarFaceIcons";
import {
  CircleDanceIcon,
  DancerFigureIcon,
  MusicalNotesIcon,
  PomegranateIcon,
} from "./avatars/avatarSymbolIcons";

/**
 * The one place an `AvatarId` becomes a rendered icon.
 *
 * A `Record`, not a `switch`: TypeScript refuses to compile this file if
 * `AvatarId` ever gains or loses a member without a matching key here — the
 * same guarantee `tests/unit/avatar.test.ts` checks again at the value level,
 * since a type-level guarantee says nothing about `AVATAR_IDS` (a runtime
 * array) staying in step with it.
 */
const AVATAR_ICONS: Record<AvatarId, () => React.ReactNode> = {
  woman_short_hair: WomanShortHairIcon,
  man_curly: ManCurlyIcon,
  woman_long_hair: WomanLongHairIcon,
  man_glasses: ManGlassesIcon,
  woman_gray_bun: WomanGrayBunIcon,
  man_bald_mustache: ManBaldMustacheIcon,
  woman_curly_gray: WomanCurlyGrayIcon,
  man_gray_beard: ManGrayBeardIcon,
  dancer_figure: DancerFigureIcon,
  circle_dance: CircleDanceIcon,
  pomegranate: PomegranateIcon,
  musical_notes: MusicalNotesIcon,
};

/**
 * Renders one preset avatar, sized by its container.
 *
 * No `<img>`, no upload, no storage bucket this phase — every avatar is one of
 * a closed set of inline SVGs (docs/decisions/0019), so this is a lookup and a
 * render, never a fetch. `size-full` on the inner `<svg>` (see the icon files)
 * is what lets a caller size the badge with an ordinary Tailwind size class on
 * the wrapper rather than this component taking a `size` prop of its own.
 *
 * `aria-hidden` on every icon (set once, in the icon files): the accessible
 * name belongs to whatever renders the avatar — a `<label>` in the picker, or
 * `alt`-equivalent text passed by a caller — never to the decorative artwork
 * itself.
 */
export function Avatar({ id, className }: { id: AvatarId; className?: string }) {
  const Icon = AVATAR_ICONS[id];
  return (
    <span className={className}>
      <Icon />
    </span>
  );
}

/** Re-exported so a picker can iterate the same set this component can render. */
export { AVATAR_IDS };
