import { AVATAR_IDS, type AvatarId } from "@/lib/domain/avatar";
import { Avatar } from "./Avatar";
import { he } from "@/lib/i18n/he";

/**
 * Every preset avatar, as a grid of real radio buttons — never a dropdown.
 *
 * `VenuePicker.tsx` and `formStyles.ts`'s own note on `RADIO_OPTION_CLASS`
 * both make the same argument this makes again here: a picked choice this
 * visible has to stay visible while picking (AGENTS.md §2.7), which a
 * `<select>` collapsing to one line cannot do, and twelve small pictures need
 * to be SEEN side by side to be compared at all.
 *
 * Each tile is `min-h-12 min-w-12` (48px, AGENTS.md §5) with the avatar
 * filling it, and the label is visually hidden rather than removed — the
 * picture alone does not name the choice for a screen reader, but this
 * audience compares tiles by looking at them, not by reading twelve captions
 * (AGENTS.md §2).
 */
export function AvatarPicker({
  name,
  value,
  onChange,
}: {
  /** The native `name` grouping the radios, so arrow-key navigation works. */
  name: string;
  value: AvatarId;
  onChange: (id: AvatarId) => void;
}) {
  return (
    <fieldset>
      <legend className="pb-2 font-bold">{he.profileEdit.avatarLabel}</legend>
      <div className="grid grid-cols-4 gap-3">
        {AVATAR_IDS.map((id) => (
          <label
            key={id}
            // size-16 (64px) rather than the 48px floor exactly: AGENTS.md §5's
            // 48px is a MINIMUM, and a tile this size is also the artwork —
            // bigger than the floor is what makes twelve small illustrations
            // tellable apart at a glance for this audience (AGENTS.md §2).
            className="flex size-16 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-muted/50 p-1 has-[:checked]:border-secondary has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-secondary"
          >
            <input
              type="radio"
              name={name}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              className="sr-only"
            />
            {/*
              pointer-events-none: without it, a real tap or click anywhere on
              the artwork hits the SVG rather than the radio underneath it,
              and a browser only forwards a click to a wrapped input from a
              click that reaches the <label> itself. The label still receives
              and forwards every tap once the decorative layer stops
              intercepting them — the same reasoning `aria-hidden` on these
              icons already gives for assistive tech, restated for the pointer.
            */}
            <Avatar id={id} className="pointer-events-none block size-full" />
            <span className="sr-only">{he.avatars[id]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
