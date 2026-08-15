/**
 * The four folk/dance-motif presets (Phase 4.3, docs/decisions/0019) — for
 * anyone who would rather pick a symbol than a face. Same badge frame as
 * `avatarFaceIcons.tsx` (background circle, ink 2px outline), same
 * `aria-hidden` — the picker's own label carries the accessible name.
 */

const BADGE_STROKE = "var(--color-ink)";

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

/**
 * A figure with both arms raised and a flared skirt — the single dancer, not
 * the group. Built from a small number of straight lines and one trapezoid
 * on purpose: at badge size, clear geometry reads better than a curved
 * silhouette, which is the lesson the first version of this icon taught —
 * curved arms blending into a curved skirt read as neither.
 */
export function DancerFigureIcon() {
  return (
    <Badge tint="var(--color-accent)" opacity={0.18}>
      <circle cx="32" cy="16" r="5" fill="var(--color-ink)" />
      <path d="M32 21v11" stroke="var(--color-ink)" strokeWidth="2.4" strokeLinecap="round" />
      {/* Both arms, straight lines up and outward from the shoulder. */}
      <path
        d="M32 25L19 14M32 25L45 14"
        stroke="var(--color-ink)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* The skirt: a plain trapezoid, wide at the hem. */}
      <path d="M25 32h14l6 15H19z" fill="var(--color-accent)" />
      <path
        d="M27 47l-4 7M37 47l4 7"
        stroke="var(--color-ink)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </Badge>
  );
}

/**
 * Three simple figures around a ring, joined by straight lines — a הורה, not
 * a lone dancer. Each figure is just a head and a short body stroke; the
 * straight "joined hands" lines between them are what the first version's
 * curved arcs failed at, reading as a tangle rather than three people in a
 * circle. The bodies angle slightly outward from the ring's centre, which is
 * what a photograph of a real horah actually looks like from above.
 */
export function CircleDanceIcon() {
  const figure = (cx: number, cy: number, key: string) => (
    <g key={key}>
      <circle cx={cx} cy={cy} r="3.6" fill="var(--color-ink)" />
      <path
        d={`M${cx} ${cy + 3.6}v7`}
        stroke="var(--color-ink)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </g>
  );
  return (
    <Badge tint="var(--color-highlight)" opacity={0.3}>
      {figure(32, 15, "top")}
      {figure(17, 34, "left")}
      {figure(47, 34, "right")}
      {/* Joined hands: one straight line between each neighbouring pair. */}
      <path
        d="M29.5 17.5L19.5 32M34.5 17.5L44.5 32M20.5 36L43.5 36"
        stroke="var(--color-accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </Badge>
  );
}

/** The badge whose name matches --color-accent's own comment in globals.css. */
export function PomegranateIcon() {
  return (
    <Badge tint="var(--color-surface)" opacity={1}>
      {/* Calyx — the crown a pomegranate is drawn by. */}
      <path
        d="M27 15l2 5M32 13v5M37 15l-2 5"
        stroke="var(--color-highlight)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M29 19h6l-1 4h-4z" fill="var(--color-highlight)" />
      {/* The body. */}
      <path
        d="M20 32q0-10 12-10t12 10q1 15-12 21q-13-6-12-21z"
        fill="var(--color-accent)"
      />
      {/* A few seeds, in the paper tone so they read as texture, not decoration on top. */}
      <circle cx="27" cy="33" r="1.6" fill="var(--color-surface)" />
      <circle cx="33" cy="30" r="1.6" fill="var(--color-surface)" />
      <circle cx="38" cy="34" r="1.6" fill="var(--color-surface)" />
      <circle cx="30" cy="39" r="1.6" fill="var(--color-surface)" />
      <circle cx="36" cy="41" r="1.6" fill="var(--color-surface)" />
    </Badge>
  );
}

/** Two beamed eighth notes — the music a dance happens to. */
export function MusicalNotesIcon() {
  return (
    <Badge tint="var(--color-secondary)" opacity={0.16}>
      <ellipse
        cx="24"
        cy="42"
        rx="5"
        ry="3.8"
        fill="var(--color-secondary)"
        transform="rotate(-12 24 42)"
      />
      <ellipse
        cx="42"
        cy="38"
        rx="5"
        ry="3.8"
        fill="var(--color-secondary)"
        transform="rotate(-12 42 38)"
      />
      <path d="M28.5 40V17l16-4v22" stroke="var(--color-secondary)" strokeWidth="2.2" fill="none" />
      <path d="M28.5 17l16-4v5l-16 4z" fill="var(--color-secondary)" />
    </Badge>
  );
}
