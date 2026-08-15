/**
 * The eight illustrated-face presets (Phase 4.3, docs/decisions/0019).
 *
 * One deliberate choice runs through all eight: nobody has a skin tone. This
 * is a small, curated preset set, not an identity-representation feature, and
 * picking a handful of skin tones to include would inevitably say more about
 * who was left out than who was included. Variety instead comes from hair,
 * age markers and accessories — safer ground for a small fixed set, and it
 * still gives most people something that reads as "a person like me" rather
 * than one generic silhouette repeated twelve times.
 *
 * Age reads through COLOUR, consistently: `--color-ink` hair is young,
 * `--color-muted` hair is grey (four of the eight — man_glasses does not fit
 * either bucket cleanly and stays ink). That is the one signal doing double
 * duty for "several should read older, for the 50+ audience" — no separate
 * wrinkle iconography needed, which would only clutter a badge this small.
 *
 * Every icon shares one frame — background circle, ink 2px outline, a
 * surface-filled head with the same two-dot eyes and the same simple smile —
 * so the SET reads as one family at a glance. `aria-hidden`, always: the
 * accessible name is the label the picker renders beside it
 * (`he.avatars[id]`), the same split TabBar's own icons use.
 */

const BADGE_STROKE = "var(--color-ink)";
const FACE_FILL = "var(--color-surface)";

/** The circle every face sits inside, with its background tint. */
function Badge({
  tint,
  opacity,
  children,
}: {
  tint: string;
  opacity: number;
  children: React.ReactNode;
}) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="size-full">
      <circle cx="32" cy="32" r="30" fill={tint} fillOpacity={opacity} />
      <circle cx="32" cy="32" r="30" fill="none" stroke={BADGE_STROKE} strokeWidth="2" />
      {children}
    </svg>
  );
}

/** The plain head, eyes and smile every face variant draws on top of. */
function FaceBase() {
  return (
    <>
      <circle cx="32" cy="35" r="15" fill={FACE_FILL} stroke={BADGE_STROKE} strokeWidth="2" />
      <circle cx="26.5" cy="33" r="1.8" fill={BADGE_STROKE} />
      <circle cx="37.5" cy="33" r="1.8" fill={BADGE_STROKE} />
      <path
        d="M25 41q7 6 14 0"
        stroke={BADGE_STROKE}
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    </>
  );
}

export function WomanShortHairIcon() {
  return (
    <Badge tint="var(--color-surface)" opacity={1}>
      <FaceBase />
      <path
        d="M17 32q-1-16 15-16t15 16q-3-4-7-4.5v6.5h-2v-8q-6-1.5-12 0v8h-2v-6.5q-4 .5-7 4.5z"
        fill="var(--color-ink)"
      />
    </Badge>
  );
}

export function ManCurlyIcon() {
  const dot = (cx: number, cy: number) => (
    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={4.2} fill="var(--color-ink)" />
  );
  return (
    <Badge tint="var(--color-highlight)" opacity={0.28}>
      {dot(20, 24)}
      {dot(26, 19)}
      {dot(33, 17)}
      {dot(40, 19)}
      {dot(46, 25)}
      {dot(23, 29)}
      {dot(42, 29)}
      <FaceBase />
    </Badge>
  );
}

export function WomanLongHairIcon() {
  return (
    <Badge tint="var(--color-accent)" opacity={0.16}>
      {/*
        Same thin top-arch-plus-two-strands formula as WomanShortHairIcon,
        just recoloured and with the strands run longer — that keeps this
        reading as HAIR framing the face rather than the hood a solid arch
        across the whole forehead looked like on the first pass.
      */}
      <path
        d="M17 33q-1-17 15-17t15 17q-3-4-7-4.5v16h-2v-17.5q-6-1.5-12 0v17.5h-2v-16q-4 .5-7 4.5z"
        fill="var(--color-accent)"
      />
      <FaceBase />
    </Badge>
  );
}

export function ManGlassesIcon() {
  return (
    <Badge tint="var(--color-secondary)" opacity={0.14}>
      <path
        d="M18 30q0-14 14-14t14 14q-3-5-14-5t-14 5z"
        fill="var(--color-ink)"
      />
      <FaceBase />
      <circle
        cx="26.5"
        cy="33.5"
        r="5"
        fill="none"
        stroke="var(--color-secondary)"
        strokeWidth="2"
      />
      <circle
        cx="37.5"
        cy="33.5"
        r="5"
        fill="none"
        stroke="var(--color-secondary)"
        strokeWidth="2"
      />
      <line
        x1="31.5"
        y1="33.5"
        x2="32.5"
        y2="33.5"
        stroke="var(--color-secondary)"
        strokeWidth="2"
      />
    </Badge>
  );
}

export function WomanGrayBunIcon() {
  return (
    <Badge tint="var(--color-surface)" opacity={1}>
      <path
        d="M17 33q-1-17 15-17t15 17q-3-5-8-5.5v3.5h-2v-5q-5-1-10 0v5h-2v-3.5q-5 .5-8 5.5z"
        fill="var(--color-muted)"
      />
      <circle cx="32" cy="14" r="5" fill="var(--color-muted)" />
      <FaceBase />
      <circle
        cx="26.5"
        cy="33.5"
        r="4.5"
        fill="none"
        stroke="var(--color-secondary)"
        strokeWidth="1.8"
      />
      <circle
        cx="37.5"
        cy="33.5"
        r="4.5"
        fill="none"
        stroke="var(--color-secondary)"
        strokeWidth="1.8"
      />
      <line
        x1="31"
        y1="33.5"
        x2="33"
        y2="33.5"
        stroke="var(--color-secondary)"
        strokeWidth="1.8"
      />
    </Badge>
  );
}

export function ManBaldMustacheIcon() {
  return (
    <Badge tint="var(--color-highlight)" opacity={0.28}>
      <path
        d="M18 27q1-4 4-6q-2 3-1 8z"
        fill="var(--color-muted)"
      />
      <path
        d="M46 27q-1-4-4-6q2 3 1 8z"
        fill="var(--color-muted)"
      />
      <FaceBase />
      <path
        d="M25.5 39q3 2 6.5 2t6.5-2q-1 3-6.5 3t-6.5-3z"
        fill="var(--color-muted)"
      />
    </Badge>
  );
}

export function WomanCurlyGrayIcon() {
  const dot = (cx: number, cy: number, r = 4.5) => (
    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="var(--color-muted)" />
  );
  return (
    <Badge tint="var(--color-secondary)" opacity={0.14}>
      {dot(18, 27)}
      {dot(23, 20)}
      {dot(31, 16)}
      {dot(39, 16)}
      {dot(46, 20)}
      {dot(48, 28)}
      {dot(21, 32)}
      {dot(45, 32)}
      <FaceBase />
      <circle
        cx="26.5"
        cy="33.5"
        r="4.5"
        fill="none"
        stroke="var(--color-secondary)"
        strokeWidth="1.8"
      />
      <circle
        cx="37.5"
        cy="33.5"
        r="4.5"
        fill="none"
        stroke="var(--color-secondary)"
        strokeWidth="1.8"
      />
      <line
        x1="31"
        y1="33.5"
        x2="33"
        y2="33.5"
        stroke="var(--color-secondary)"
        strokeWidth="1.8"
      />
    </Badge>
  );
}

export function ManGrayBeardIcon() {
  return (
    <Badge tint="var(--color-surface)" opacity={1}>
      {/* A thin hairline cap, well clear of the eyes below it. */}
      <path d="M19 27q2-9 13-9t13 9q-3-3-13-3t-13 3z" fill="var(--color-muted)" />
      <FaceBase />
      {/*
        The beard sits below the smile (drawn around y=41-47 by FaceBase), not
        over it — an earlier version started this at y=39 and covered the
        smile entirely, reading as a grey blob instead of facial hair on a
        visible face.
      */}
      <path
        d="M21 45q1 8 11 9q10-1 11-9q-3 3-11 3t-11-3z"
        fill="var(--color-muted)"
      />
    </Badge>
  );
}
