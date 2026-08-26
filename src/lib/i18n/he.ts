/**
 * Every user-facing string (AGENTS.md §7 — no hardcoded Hebrew in components).
 *
 * Vocabulary is the community's own (§2.8): "הרקדה", not "אירוע"; "מרקיד/ה",
 * not "מארגן". Status words are full words on purpose — a cancelled dance says
 * "בוטל", never just a red ring (§2.6).
 */
export const he = {
  common: {
    appName: "לרקוד",
    /**
     * Says the screen is unfinished in plain words. A blank screen reads as a
     * bug to this audience (AGENTS.md §2) — an empty route still has to say
     * something.
     */
    screenNotReady: "המסך הזה עדיין בבנייה.",
  },
  /**
   * The accessible name for each preset avatar (Phase 4.3, docs/decisions/0019),
   * spoken by a screen reader on its radio tile and used as this dictionary's
   * one runtime check that every `AvatarId` has Hebrew words to go with it —
   * `tests/unit/avatar.test.ts` asserts this object's keys match `AVATAR_IDS`
   * exactly, so a thirteenth avatar cannot ship silently mute.
   *
   * Described by what they show, not by a marketing name: a screen reader user
   * choosing between tiles needs "אישה, שיער אפור אסוף" to mean something on
   * its own, out of context.
   */
  avatars: {
    woman_short_hair: "אישה עם שיער קצר",
    man_curly: "גבר עם שיער מתולתל",
    woman_long_hair: "אישה עם שיער ארוך",
    man_glasses: "גבר עם משקפיים",
    woman_gray_bun: "אישה עם שיער אפור אסוף",
    man_bald_mustache: "גבר קירח עם שפם",
    woman_curly_gray: "אישה עם שיער אפור מתולתל",
    man_gray_beard: "גבר עם זקן אפור",
    dancer_figure: "דמות רוקדת",
    circle_dance: "מעגל רוקדים",
    pomegranate: "רימון",
    musical_notes: "תווים מוזיקליים",
  },
  home: {
    heading: "הרקדות קרובות",
    /**
     * Phase 4.6c's light map-screen framing — sits between the app header and
     * the map itself, so the screen reads as an answer to a question rather
     * than opening cold on a grey box (AGENTS.md §2: this audience should not
     * have to infer what the map is for).
     */
    tagline: "מה קורה הערב לידך?",
    /** Shown when the proximity query comes back empty — not an error state. */
    empty: "לא נמצאו הרקדות באזור הזה בימים הקרובים.",
    listLabel: "רשימת ההרקדות הקרובות",
    /** The explicit prev/next controls alongside the scrollable ring list (AGENTS.md §2.7). */
    prevLabel: "הרקדות קודמות",
    nextLabel: "הרקדות נוספות",
  },
  map: {
    /** Names the map region, so a screen reader user can skip it or jump to it. */
    regionLabel: "מפת ההרקדות",
    /**
     * The map arrives after first paint (docs/decisions/0011), so this is what
     * stands in until it does. An empty box reads as a broken app to this
     * audience — the same reason `common.screenNotReady` exists.
     */
    loading: "המפה נטענת…",
    /**
     * Shown when the map cannot load at all — no key, no network, a blocked
     * script. Says where the dances still are, because they are all listed
     * below and nothing is actually lost.
     */
    unavailable: "לא הצלחנו להציג את המפה. כל ההרקדות מופיעות ברשימה שמתחת.",
    /** The explicit, visible control that asks for location. Never asked silently (AGENTS.md §9). */
    locate: "הצגת הרקדות לידי",
    locating: "מאתרים את המיקום שלך…",
    located: "המפה מציגה הרקדות ליד המיקום שלך.",
    /**
     * Covers refusal, an unavailable sensor, and a browser with no geolocation
     * at all. One message on purpose: they differ only in a cause the dancer
     * cannot act on, and all three leave the screen in the same working state.
     */
    locateFailed: "לא הצלחנו לאתר אותך. המפה ממשיכה להציג את אזור גוש דן.",
    preview: {
      /** Names the panel that opens when a pin is chosen. */
      label: "פרטי ההרקדה שנבחרה",
      close: "סגירת הפרטים",
      /** Sits where the panel will be, so the map is not a control with no visible result. */
      hint: "בחרו סימון על המפה כדי לראות פרטים ולנווט.",
      /**
       * Waze first — it is what this audience drives with in Israel (§9). Both
       * name the venue, so the link makes sense read on its own out of context.
       */
      waze: (venue: string): string => `ניווט ל${venue} עם ווייז`,
      googleMaps: (venue: string): string => `ניווט ל${venue} עם גוגל מפות`,
      shareWhatsapp: "שיתוף בוואטסאפ",
      addToCalendar: "הוספה ליומן",
      /**
       * Phase 4.6c: the visible captions on the panel's three tinted square
       * buttons. Short on purpose — the full sentence (`waze`, `shareWhatsapp`,
       * `addToCalendar` above) stays the control's `aria-label`, so a screen
       * reader still hears the whole thing; these three are only what a
       * sighted dancer reads next to the icon. "ניווט" rather than "וייז":
       * Waze is what the link opens, but the WORD on the button names the
       * action, the same way the aria-label already leads with "ניווט".
       */
      navigateShort: "ניווט",
      shareShort: "שיתוף",
      calendarShort: "יומן",
      /**
       * The WhatsApp share message (Phase 4.6a). Plain text, one fact per
       * line, so it reads cleanly if pasted anywhere and not only inside a
       * WhatsApp bubble — no markup, no emoji standing in for a word.
       * `status` carries the same "בוטל"/"המיקום שונה" wording the badge shows
       * (AGENTS.md §2.6): a dancer sharing a cancelled night should not
       * accidentally invite someone to a hall that is dark.
       */
      shareText: ({
        instructor,
        weekday,
        timeRange,
        venue,
        address,
        status,
        mapsUrl,
      }: {
        instructor: string;
        weekday: string;
        timeRange: string;
        venue: string;
        address: string;
        status: string | null;
        mapsUrl: string;
      }): string =>
        `הרקדה עם ${instructor}\n${weekday}, ${timeRange}${
          status === null ? "" : `\n${status}`
        }\n${venue}, ${address}\nניווט: ${mapsUrl}`,
    },
  },
  distanceFilter: {
    legend: "מרחק לחיפוש",
    option: (kilometers: number): string => `עד ${kilometers} ק״מ`,
    updating: "מעדכנים את ההרקדות…",
    updateFailed: "לא הצלחנו לעדכן את המרחק. אפשר לנסות שוב.",
  },
  nav: {
    /** Names the <nav> landmark, so a screen reader can jump straight to it. */
    label: "ניווט ראשי",
    map: "מפה",
    schedule: "לוח",
    /**
     * Phase 4.1 rename from "שלי": the tab now leads to a real screen with two
     * states (sign in / signed-in profile), not a placeholder, so it needs a
     * name that describes a place rather than a possessive. Two words with a
     * natural break at the space — unlike "מועדפים" in docs/decisions/0007/8,
     * which had none — but still verified not to wrap at 200% on a 375px
     * viewport (tests/e2e/navigation.spec.ts).
     */
    profile: "אזור אישי",
  },
  profileMenu: {
    open: "פתיחת תפריט ניווט",
    close: "סגירת תפריט ניווט",
    title: "מעבר מהיר",
    navigationLabel: "ניווט באזור האישי",
    home: "מפה",
    myArea: "אזור אישי",
    backToProfile: "חזרה לאזור האישי",
    createDance: "בניית הרקדה חדשה",
    purchases: "הרכישות שלי",
  },
  /**
   * The DEMO_MODE toggle (AGENTS.md §13 Phase 4.0): one button in the header
   * that hides every dance from the map and the schedule, for showing the app
   * with an empty state. Display only — never rendered when
   * NEXT_PUBLIC_DEMO_MODE is unset, so a real dancer in production never sees
   * these strings.
   */
  demo: {
    hide: "הסתר הרקדות",
    show: "הצג הרקדות",
    /**
     * The gated demo sign-in (Phase 4.2, docs/decisions/0018). Only rendered by a
     * build with DEMO_LOGIN_ENABLED set, which production never is — so, like the
     * toggle above, a real dancer never reads any of this.
     *
     * Written for whoever is DRIVING a demo, not for a dancer: it says "type 0"
     * plainly instead of dressing the mechanism up, because the person reading it
     * is showing the product to somebody else and needs to know what will happen.
     */
    signIn: {
      heading: "כניסה להדגמה",
      intro: "מספר 0 נכנס כמרקיד. מספר 1 ומעלה נכנסים כרוקדים.",
      numberLabel: "מספר משתמש להדגמה",
      submit: "אישור",
      signingIn: "נכנסים…",
      /** Names who you just became — a demo driver needs to see which account answered. */
      signedInAs: (name: string): string => `נכנסתם בתור ${name}.`,
      errors: {
        /**
         * The server flag is off. Reached only if a form somehow rendered without
         * one — the gate is server-side and answers this before touching anything
         * (see demoAuthActions.ts), so this string exists to make a refusal
         * legible rather than to describe an expected state.
         */
        disabled: "הכניסה להדגמה אינה פעילה.",
        unknownNumber: "אין משתמש הדגמה עם המספר הזה.",
        failed: "לא הצלחנו להיכנס. אפשר לנסות שוב.",
      },
    },
  },
  schedule: {
    heading: "לוח הרקדות",
    /**
     * "בחודשיים הקרובים" is not a rounded-up figure — find_dances_near looks 60
     * days ahead and no further (migration 0003), so promising more here would
     * describe a query we do not run.
     */
    empty: "לא נמצאו הרקדות באזור הזה בחודשיים הקרובים.",
    /** Names one day's list, so the days are distinguishable when tabbing between them. */
    dayListLabel: (day: string): string => `הרקדות ב${day}`,
  },
  /**
   * The level/type/women-only filter (Phase 4.6b), shared by the map and the
   * schedule — one dictionary, one client component, so the two screens do
   * not drift into two different filter vocabularies. Always visible rather
   * than behind a toggle (AGENTS.md §2 — fewer steps, even at the cost of
   * more vertical space) and client-side on the set the server already
   * queried (docs/decisions/0005 covers why the proximity query itself stays
   * server-side; filtering that result further is a display concern).
   */
  filters: {
    heading: "סינון הרקדות",
    /**
     * Collapsed by default (Phase 4.6b): the panel starts behind this one
     * button rather than always open. Ten extra always-visible controls
     * ahead of the map/ring list and the nav tabs is a real keyboard-reach
     * cost on the busiest screen in the app — a guest arriving from a
     * WhatsApp link (AGENTS.md §2.1) meets the filter before the dances it
     * filters. One toggle, and `close` below to put it away again — the same
     * disclosure shape `publishDance.addVenueToggle`/`profileEdit.toggle`
     * already use.
     */
    toggle: "סינון הרקדות",
    close: "סגירת הסינון",
    levelLabel: "רמה",
    /** The default, unfiltered level option — distinct from `dance.level.all_levels`, which is a dance's OWN attribute, not "no filter". */
    anyLevel: "הכול",
    typeLabel: "סוג ההרקדה",
    womenOnlyLabel: "רק הרקדות לנשים בלבד",
    /** Shown when a filter narrows a non-empty result down to nothing. */
    emptyFiltered: "אין הרקדות שמתאימות לסינון שבחרתם.",
  },
  /**
   * Managing the nights you already published — cancelling one, or moving it to
   * a different hour or venue. One night at a time; changing the pattern of a whole
   * series is not something this screen offers.
   *
   * The words avoid "מופע", "אירוע" and "תזמון". A מרקיד says "הרקדה" and
   * "שעה" (AGENTS.md §2.8), and every control here says what it does to a
   * specific evening rather than naming a feature.
   */
  manageNights: {
    heading: "ההרקדות שלי",
    intro: "כאן אפשר לבטל הרקדה או לשנות את השעה או המקום שלה. הרוקדים יראו את השינוי מיד.",
    /** Shown to an instructor whose dances are all behind them or not yet published. */
    empty: "אין הרקדות קרובות לנהל.",
    /** Names the list for a screen reader, and says what window it covers. */
    listLabel: "ההרקדות הקרובות שלכם",
    /** "יום שני, 17 באוגוסט בשעה 20:00" — which night a control acts on. */
    whenText: (day: string, time: string): string => `${day} בשעה ${time}`,
    /** Opens the controls for one night. Names the night so it is not "עריכה" ×12. */
    manage: (when: string): string => `שינוי ההרקדה ב${when}`,
    close: "סגירה",
    cancelledOn: (reason: string): string => `סיבת הביטול: ${reason}`,
    cancelledNoReason: "ההרקדה בוטלה.",

    changeTimeHeading: "שינוי השעה",
    startTimeLabel: "שעת התחלה",
    endTimeLabel: "שעת סיום",
    saveTime: "שמירת השעה",
    savingTime: "שומרים…",
    timeSaved: "השעה עודכנה. הרוקדים רואים אותה עכשיו.",

    changeVenueHeading: "שינוי המקום",
    saveVenue: "שמירת המקום",
    savingVenue: "שומרים…",
    venueSaved: "המקום עודכן. הרוקדים רואים אותו עכשיו.",

    /**
     * Two steps, on purpose. Cancelling is the one action here a dancer feels,
     * and this audience should not be able to do it with a single stray tap —
     * but a browser `confirm()` is a dialog they cannot read at their own text
     * size, so the confirmation is part of the page.
     */
    cancelHeading: "ביטול ההרקדה",
    cancelIntro: "הרוקדים יראו שההרקדה בוטלה, במקום שההרקדה תיעלם מהלוח.",
    cancelStart: "ביטול ההרקדה",
    reasonLabel: "סיבת הביטול (לא חובה)",
    reasonHint: "לדוגמה: תקלה במזגן באולם. הסיבה תוצג לרוקדים.",
    cancelConfirm: "כן, לבטל את ההרקדה",
    cancelBack: "לא, להשאיר את ההרקדה",
    cancelling: "מבטלים…",
    cancelled: "ההרקדה בוטלה. הרוקדים רואים זאת עכשיו בלוח ובמפה.",

    errors: {
      startTime: "צריך לבחור שעת התחלה תקינה.",
      endTime: "צריך לבחור שעת סיום תקינה, אחרי שעת ההתחלה.",
      venue: "צריך לבחור מקום להרקדה.",
      /** The stored date is unreadable — a server-side problem, not something to fix in the form. */
      date: "לא הצלחנו לקרוא את תאריך ההרקדה. אפשר לנסות שוב.",
      /** Somebody else's night, or one that no longer exists. */
      notYours: "ההרקדה הזאת אינה שלכם או שאינה קיימת יותר.",
      failed: "לא הצלחנו לשמור את השינוי. אפשר לנסות שוב.",
    },
  },
  /** Now a section inside /profile, not its own route or tab — see docs/decisions/0008. */

  purchases: {
    heading: "הרכישות שלי",
    ticketsHeading: "כרטיסים",
    punchCardsHeading: "כרטיסיות",
    creditsHeading: "זיכויים",
    noPurchases: "אין רכישות",
    noTickets: "אין כרטיסים פעילים.",
    noPunchCards: "אין כרטיסיות פעילות.",
    noCredits: "אין זיכויים פעילים.",
    useCredit: "לנצל את הזיכוי",
    requestRefund: "בקשת החזר כספי",
    refundRequested: "הוגשה בקשה להחזר",
    selectDanceLabel: "בחירת הרקדה",
    redeemButton: "מימוש",
    redeemSuccess: "הזיכוי מומש בהצלחה.",
    refundSuccess: "בקשת ההחזר נשלחה.",
    creditAmount: (amount: number) => `₪${amount}`,
    expiresAt: (date: string) => `בתוקף עד ${date}`,
    remainingUses: (rem: number, total: number) => `${rem} מתוך ${total} כניסות`,
    cancelRedeem: "ביטול",

    ticketStatuses: {
      valid: "פעיל",
      used: "מומש",
      cancelled: "בוטל",
      credited: "זוכה",
    },
    ticketStatusLabel: (status: string) => `סטטוס: ${status}`,
  },
  favorites: {
    heading: "מועדפים",
    /**
     * Phase 4.5 gave this section a real list — this stays for the genuinely
     * empty case, i.e. a signed-in dancer with nothing saved yet, never
     * `common.screenNotReady`.
     */
    empty: "עדיין אין מועדפים.",
    /**
     * Doubles as the guest's reply to tapping a heart, on the map, the
     * schedule, or here — never an error, per AGENTS.md §2.2: a guest is not
     * missing a permission, they are one sign-in away. Reused rather than
     * duplicated, so the two moments a guest meets favorites say the same
     * thing.
     */
    signedOutEmpty: "התחברו כדי לשמור הרקדות מועדפות.",
    /** Names the list of favorited nights for a screen reader. */
    listLabel: "ההרקדות המועדפות שלכם",
    /**
     * The heart's accessible name, naming the dance it acts on the same way
     * `manageNights.manage` names the night its control opens — a screen
     * reader user tabbing between several hearts needs each one to say which
     * dance it is, not just "הוספה למועדפים" ×12.
     */
    add: (venue: string): string => `הוספה למועדפים: ${venue}`,
    remove: (venue: string): string => `הסרה מהמועדפים: ${venue}`,
    /**
     * Phase 4.6c: the VISIBLE text on the map preview panel's wide favorite
     * pill (`FavoriteButton`'s `variant="pill"`). Short, unlike `add`/`remove`
     * above, because the pill sits right under the venue name it would
     * otherwise repeat — `add`/`remove` stay the button's `aria-label`, which
     * is what still names the venue for a screen reader.
     */
    saveShort: "שמירה למועדפים",
    removeShort: "הסרה מהמועדפים",
    errors: {
      failed: "לא הצלחנו לשמור. אפשר לנסות שוב.",
    },
  },
  profile: {
    /** Phase 4.1: matches nav.profile so the tab and the screen it opens agree. */
    heading: "אזור אישי",
    /** The signed-in state. Says who you are, in the words a dancer gave us. */
    signedInAs: (phone: string): string => `מחוברים עם המספר ${phone}`,
    signOut: "יציאה מהחשבון",
    signingOut: "יוצאים…",
    /** Greets by the name the dancer chose, once there is a profile row. */
    greeting: (name: string): string => `שלום, ${name}`,
    /**
     * The secondary role-declaration path (Phase 4.2, docs/decisions/0018): what a
     * signed-in רוקד sees where a מרקיד sees the publish and manage surfaces.
     *
     * An invitation, not an error message. A dancer is not missing anything and
     * should not be told they lack a permission — the words offer a thing to
     * become, which is what ticking the box at sign-in would have done.
     */
    becomeInstructor: {
      heading: "רוצה להרקיד?",
      intro: "אפשר לפרסם הרקדות משלכם ולנהל אותן מכאן.",
      cta: "אני מרקיד/ה",
      working: "רק רגע…",
      failed: "לא הצלחנו לעדכן. אפשר לנסות שוב.",
    },
  },
  /**
   * Editing the name and avatar AFTER there is already a profile row — Phase
   * 4.3. `profileName` above is the separate, one-time "what should we call
   * you" step `saveProfileName` answers; this is `updateOwnProfileAction`,
   * reached from a toggle in the signed-in screen rather than shown by
   * default, the same "toggle to reveal a secondary form" shape
   * `publishDance.addVenueToggle` already uses — the default view stays the
   * dignified, uncluttered greeting (AGENTS.md §2).
   */
  profileEdit: {
    toggle: "עריכת הפרופיל",
    cancel: "ביטול",
    nameLabel: "השם שלכם",
    /** The picker's fieldset legend — see AvatarPicker.tsx. */
    avatarLabel: "תמונת הפרופיל",
    save: "שמירה",
    saving: "שומרים…",
    errors: {
      missing: "צריך להקליד שם.",
      tooLong: "השם ארוך מדי. עד 80 תווים.",
      failed: "לא הצלחנו לשמור את השינויים. אפשר לנסות שוב.",
    },
  },
  /**
   * The instructor's PUBLIC name, editable on its own — Phase 4.3, pays the
   * debt docs/decisions/0018 recorded: declaring "אני מרקיד/ה" at sign-in
   * defaults this to the private profile name (disclosed at the time,
   * `profileName.introInstructor`), and this is where that default stops
   * being permanent. Deliberately separate wording from `profileEdit` above —
   * docs/decisions/0004 is that these are two different names, and the two
   * forms editing them should not look like one form with an extra field.
   */
  instructorName: {
    heading: "השם הפומבי שלכם",
    intro: "זה השם שהרוקדים רואים במפה ובלוח, ליד ההרקדות שלכם. הוא נפרד מהשם הפרטי שלכם.",
    label: "השם הפומבי",
    save: "שמירה",
    saving: "שומרים…",
    errors: {
      missing: "צריך להקליד שם.",
      tooLong: "השם ארוך מדי. עד 80 תווים.",
      failed: "לא הצלחנו לשמור את השם. אפשר לנסות שוב.",
    },
  },
  /**
   * Setting a name — the step between signing in and being able to publish.
   * `profiles.display_name` is NOT NULL, so nothing else can happen first.
   *
   * Worded as an introduction, not as a form to complete: "איך קוראים לכם" is
   * what a person at the door would ask, and this audience should not meet the
   * word "פרופיל" before it has done anything for them (AGENTS.md §2.8).
   */
  profileName: {
    heading: "איך קוראים לכם?",
    intro: "השם הזה פרטי ומשמש אותנו כדי לפנות אליכם. הוא לא מוצג לרוקדים אחרים.",
    /**
     * The same step, for somebody who ticked "אני מרקיד/ה" on the way in.
     *
     * Says the opposite of `intro` above, on purpose. That one promises the name
     * stays private, and for a רוקד it does. For somebody becoming a מרקיד in
     * this same step the name ALSO becomes their public one, and
     * docs/decisions/0004 is explicit that the private and public names are
     * different things which must never be silently promoted one into the other.
     * Disclosing it here is what keeps the one-step flow honest; the name can
     * still be changed later from the publish form.
     */
    introInstructor:
      "השם הזה ישמש אותנו כדי לפנות אליכם, ויוצג גם לרוקדים ליד ההרקדות שלכם. תמיד אפשר לשנות אותו.",
    label: "השם שלכם",
    save: "שמירה",
    saving: "שומרים…",
    errors: {
      missing: "צריך להקליד שם.",
      tooLong: "השם ארוך מדי. עד 80 תווים.",
      failed: "לא הצלחנו לשמור את השם. אפשר לנסות שוב.",
    },
  },
  /**
   * Publishing one night. The vocabulary is the community's (§2.8): "הרקדה",
   * never "אירוע"; "מרקיד/ה", never "מארגן".
   */
  publishDance: {
    heading: "פרסום הרקדה",
    intro: "ההרקדה תופיע במפה ובלוח לכל הרוקדים.",
    venueLabel: "מקום ההרקדה",
    /** Names the filter box above the list of halls, so it is not a mystery field. */
    venueSearchLabel: "חיפוש מקום",
    venueSearchPlaceholder: "אפשר להקליד חלק מהשם או מהכתובת",
    recentVenuesHeading: "המקומות האחרונים שלכם",
    venueEmpty: "לא נמצא מקום שמתאים לחיפוש.",
    venueSearching: "מחפשים מקומות…",
    /** Announced when results change, so the list is not a silent update. */
    venueResultCount: (count: number): string =>
      count === 1 ? "נמצא מקום אחד." : `נמצאו ${count} מקומות.`,
    /**
     * The way out when the hall is not on the list. Phrased as the question the
     * instructor is already asking, not as a feature name (AGENTS.md §2.8).
     */
    addVenueToggle: "המקום לא ברשימה? הוספת מקום חדש",
    addVenueCancel: "חזרה לרשימת המקומות",
    addVenueHeading: "הוספת מקום חדש",
    /**
     * Says where the suggestions come from. This audience should know why a
     * third party is suggesting addresses, and it is the honest description of
     * what happens when they type.
     */
    addVenueIntro: "מחפשים את המקום בגוגל ובוחרים מהרשימה. כך הכתובת והמיקום במפה יהיו מדויקים.",
    addVenueSearchLabel: "שם המקום או הכתובת",
    addVenueSearchPlaceholder: "לדוגמה: בית ציוני אמריקה",
    /** Names the suggestion list for a screen reader; it appears and disappears as you type. */
    addVenueSuggestionsLabel: "הצעות מגוגל",
    /**
     * The alt text on Google's required attribution mark.
     *
     * The one place an English word is allowed to stand in a UI string
     * (AGENTS.md §2.8): "Google" is a brand name and the attribution is a
     * policy requirement, not a phrase we chose. Everything around it is Hebrew.
     */
    poweredByGoogle: "מופעל על ידי Google",
    addVenueEmpty: "לא נמצאו הצעות. אפשר לנסות לכתוב אחרת.",
    addVenueSaving: "מוסיפים את המקום…",
    addVenueAdded: (name: string): string => `${name} נוסף ונבחר להרקדה.`,
    addVenueErrors: {
      /** The Places script could not load — sign-in still works, adding a venue does not. */
      unavailable: "לא הצלחנו לטעון את חיפוש המקומות. אפשר לבחור מקום מהרשימה או לנסות שוב מאוחר יותר.",
      /** Covers a rejected payload and a failed insert alike; both mean "try again". */
      failed: "לא הצלחנו להוסיף את המקום. אפשר לנסות שוב.",
    },
    /**
     * The public name, asked for only on a first publish. Says plainly that it
     * is the one thing here other people see — the private/public identity split
     * is docs/decisions/0004, and it is not something to leave a person to infer.
     */
    instructorNameLabel: "השם שיוצג לרוקדים ליד ההרקדה",
    instructorNameHint: "זה השם הפומבי שלכם כמרקידים. אפשר לשנות אותו.",
    dateLabel: "תאריך",
    startTimeLabel: "שעת התחלה",
    endTimeLabel: "שעת סיום",
    /** Reassurance for the ordinary evening that ends after midnight. */
    endsNextDayHint: "הרקדה שמסתיימת אחרי חצות — אפשר להקליד את שעת הסיום כרגיל.",
    /**
     * The repeat choice. Three plain options and no weekday list: the day of the
     * week comes from the date already chosen above, so asking for it again would
     * be a second control that can contradict the first (AGENTS.md §2 — fewer
     * steps, even when it means more work for us).
     */
    repeatLegend: "כל כמה זמן ההרקדה מתקיימת?",
    repeatOnce: "פעם אחת בלבד",
    repeatWeekly: "כל שבוע",
    repeatBiweekly: "כל שבועיים",
    /** Says out loud where the weekday came from, so nothing is left to be inferred. */
    repeatHint: (weekday: string): string =>
      `ההרקדה תחזור ב${weekday}, לפי התאריך שבחרתם.`,
    untilDateLabel: "תאריך אחרון (אפשר להשאיר ריק)",
    untilDateHint: "אם ההרקדה ממשיכה ללא תאריך סיום, אפשר להשאיר את השדה ריק.",
    /**
     * Level, type(s) and women-only (Phase 4.6b) — set once at publish time,
     * shown to dancers on the map and the schedule. `levelLegend` reuses
     * `he.dance.level`'s four labels and `typeLegend` reuses
     * `he.dance.formation`'s four, so a level or a type is worded identically
     * whether it is being set here or read on the preview card.
     */
    levelLegend: "רמת ההרקדה",
    typeLegend: "סוג ההרקדה (אפשר לבחור יותר מאחד)",
    womenOnlyLabel: "הרקדה לנשים בלבד",
    flyerLabel: "פלייר או מודעה (לא חובה)",
    flyerHint: (maxMegabytes: number): string =>
      `תמונה מסוג JPG, PNG או WebP, עד ${maxMegabytes} מגה־בייט.`,
    submit: "פרסום ההרקדה",
    submitting: "מפרסמים…",
    published: "ההרקדה פורסמה ומופיעה עכשיו במפה ובלוח.",
    /** The recurring counterpart, so the number of nights created is not a mystery. */
    publishedSeries: (count: number): string =>
      `ההרקדה פורסמה. ${count} תאריכים כבר מופיעים במפה ובלוח, וההמשך יתווסף מעצמו.`,
    errors: {
      venueId: "צריך לבחור את המקום שבו תתקיים ההרקדה.",
      date: "צריך לבחור תאריך תקין.",
      startTime: "צריך לבחור שעת התחלה תקינה.",
      /**
       * Covers a missing end time, an unparseable one, and one that makes the
       * night longer than twelve hours — which in practice means the two times
       * were typed the wrong way round.
       */
      endTime: "צריך לבחור שעת סיום תקינה, אחרי שעת ההתחלה.",
      untilDate: "התאריך האחרון צריך להיות תקין ולא לפני תאריך ההתחלה.",
      /**
       * Every night the series describes is already behind us. Says which two
       * fields to look at, because those are the only two that can cause it.
       */
      noNights: "לא נמצאו תאריכים להרקדה הזאת. כדאי לבדוק את התאריך ואת התאריך האחרון.",
      flyerType: "אפשר לצרף רק תמונה מסוג JPG, PNG או WebP.",
      flyerTooLarge: "התמונה גדולה מדי. אפשר לצרף תמונה עד 5 מגה־בייט.",
      flyerUploadFailed: "ההרקדה פורסמה, אבל לא הצלחנו לצרף את הפלייר. אפשר לנסות שוב מניהול ההרקדות.",
      failed: "לא הצלחנו לפרסם את ההרקדה. אפשר לנסות שוב.",
    },
  },
  manageFlyers: {
    heading: "פליירים להרקדות",
    intro: "אפשר להוסיף, להחליף או להסיר פלייר מכל הרקדה קרובה שלכם.",
    listLabel: "עריכת פליירים להרקדות שלכם",
    danceLabel: (venue: string, day: string, time: string): string =>
      `${venue} — ${day} בשעה ${time}`,
    numberedDanceLabel: (label: string, number: number): string =>
      `${label} — הרקדה ${number}`,
    currentAlt: (dance: string): string => `הפלייר הנוכחי להרקדה: ${dance}`,
    choose: (dance: string): string => `בחירת פלייר להרקדה: ${dance}`,
    save: "שמירת הפלייר",
    saving: "שומרים…",
    remove: "הסרת הפלייר",
    saved: "הפלייר נשמר.",
    savedWithCleanupWarning: "הפלייר החדש נשמר, אבל העותק הישן לא הוסר מהמערכת.",
    removed: "הפלייר הוסר.",
    failed: "לא הצלחנו לעדכן את הפלייר. אפשר לנסות שוב.",
  },
  /**
   * Phone OTP is the only way into this product (AGENTS.md §2.3), so these
   * strings are the whole of what a dancer is told about identity. Two steps,
   * one instruction each, no jargon: not "אימות", not "קוד חד-פעמי", not "OTP".
   */
  signIn: {
    heading: "כניסה",
    /**
     * Says why an account is wanted at all, before asking for anything. A dancer
     * reaching /profile from a WhatsApp link has not been told yet, and §2.2 is
     * explicit that reading never needs an account — so this page has to justify
     * itself rather than assume.
     */
    intro: "כדי לשמור הרקדות מועדפות ולנהל הרקדות משלכם, צריך להתחבר עם מספר טלפון.",
    /**
     * The role declaration (Phase 4.2, docs/decisions/0018). Asked once, here,
     * because this is where a person says who they are — before this it was a
     * side effect of publishing, which meant nobody could become a מרקיד once
     * the publish form was gated by role.
     *
     * Phrased as an identity ("אני מרקיד/ה"), not a permission request ("בקשת
     * הרשאות"): ticking it creates an unverified מרקיד record, which any
     * signed-in person may already do for themselves. It is not a key being
     * handed over, and the words should not suggest it is.
     */
    instructorLabel: "אני מרקיד/ה",
    instructorHint: "אפשר לסמן גם אחר כך, מהאזור האישי.",
    phoneLabel: "מספר טלפון נייד",
    /** A shape to copy, not a value that gets submitted. */
    phonePlaceholder: "050-1234567",
    sendCode: "שליחת קוד",
    sending: "שולחים קוד…",
    /** Confirms where the code went, so a typo is caught before waiting for it. */
    codeSentTo: (phone: string): string => `שלחנו קוד בהודעה אל ${phone}.`,
    codeLabel: "הקוד שקיבלתם בהודעה",
    submitCode: "כניסה",
    verifying: "בודקים…",
    /** Back to step one. Visible and tappable — never a browser-back-only path (§2.7). */
    changePhone: "שינוי מספר הטלפון",
    resend: "שליחת קוד חדש",
    errors: {
      /** Covers empty, landline, and foreign numbers — one fix for all three. */
      invalidPhone: "המספר אינו נראה כמו מספר טלפון נייד ישראלי. לדוגמה: 050-1234567.",
      invalidCode: "צריך להקליד את שש הספרות שקיבלתם בהודעה.",
      /**
       * Covers a wrong code and an expired one together, because GoTrue answers
       * both identically — see the note on `badCode` in
       * `src/lib/domain/signInError.ts`. Saying "פג תוקף" to someone who simply
       * mistyped would send them to ask for a new code they do not need.
       */
      badCode: "הקוד אינו נכון או שפג תוקפו. אפשר לבדוק שוב את ההודעה או לבקש קוד חדש.",
      tooSoon: "כבר שלחנו קוד למספר הזה. אפשר לנסות שוב בעוד רגע.",
      tooSoonIn: (seconds: number): string =>
        `כבר שלחנו קוד למספר הזה. אפשר לנסות שוב בעוד ${seconds} שניות.`,
      /**
       * The SMS could not be sent at all. Deliberately does NOT say "wait a
       * moment and try again" — that is the cooldown's wording, and repeating it
       * here would send a dancer to wait for a message that is not coming. It
       * names the number as the one thing they can actually check, and otherwise
       * says the problem is ours.
       */
      sendFailed: "לא הצלחנו לשלוח את ההודעה. כדאי לבדוק שהמספר נכון ולנסות שוב מאוחר יותר.",
      /**
       * The challenge failed or its token went stale. Deliberately does not use
       * the word "קפצ׳ה" — it explains what to do, not what broke.
       */
      captcha: "בדיקת האבטחה לא הושלמה. אפשר לנסות שוב.",
      /** Anything with no specific words. Never shows a raw provider message. */
      unknown: "משהו השתבש. אפשר לנסות שוב.",
      /**
       * The challenge script itself could not load — a blocked host, an
       * extension, no network. Sign-in genuinely cannot proceed, and saying so is
       * better than a button that fails silently every time it is pressed.
       */
      securityCheckUnavailable:
        "לא הצלחנו לטעון את בדיקת האבטחה, ולכן אי אפשר להתחבר כרגע. אפשר לנסות שוב מאוחר יותר.",
      /**
       * NEXT_PUBLIC_TURNSTILE_SITE_KEY is missing, so there is nothing to render
       * and no token to send. A developer's mistake, not a dancer's — but a
       * dancer is who reads it, so it says what it means for them.
       */
      notConfigured: "הכניסה אינה זמינה כרגע.",
    },
    /**
     * Names the challenge for a screen reader. Turnstile usually resolves with
     * nothing to do, but when it does ask for something, an unlabelled iframe in
     * the middle of a form is not navigable.
     */
    securityCheckLabel: "בדיקת אבטחה",
  },
  dance: {
    /**
     * Labels for `public.dance_level` (Phase 4.6b). Keyed by the English enum
     * value, the same convention `avatars` above uses for `avatar_choice` —
     * one Hebrew word per database value, checked at the type level by
     * `Record<DanceLevel, string>` wherever this is consumed.
     */
    level: {
      beginner: "מתחילים",
      intermediate: "בינוני",
      advanced: "מתקדמים",
      all_levels: "כל הרמות",
    },
    /** Labels for `public.dance_formation` (Phase 4.6b) — how the dancers are arranged. */
    formation: {
      circle: "מעגלים",
      couples: "זוגות",
      line: "ליין",
      mixed: "מעורב",
    },
    /** The badge for a dance marked women_only — dignified, not an afterthought. */
    womenOnly: "הרקדה לנשים בלבד",
    flyerAlt: (instructor: string): string => `פלייר להרקדה עם ${instructor}`,
    status: {
      moved: "המיקום שונה",
      cancelled: "בוטל",
      /**
       * A night whose HOUR changed. Says the old time, not just "השתנה": a
       * dancer who already planned around 20:00 needs to recognise which
       * evening this is before they can act on it. The status stays
       * "scheduled" in the database — docs/decisions/0003 reserves the
       * `moved` status for a venue change — so this label is the only thing that tells them
       * (AGENTS.md §2.6, §10).
       */
      retimedFrom: (time: string): string => `הועבר מ-${time}`,
    },
    withInstructor: (instructor: string): string => `עם ${instructor}`,
    /**
     * `dance_events` carries no title column — a dance is identified by its
     * instructor, venue and time, not a name someone typed in. The calendar
     * event's SUMMARY and the WhatsApp share message's first line both name
     * it the same way `mapPinLabel` already does for the pin.
     */
    title: (instructor: string): string => `הרקדה עם ${instructor}`,
    /**
     * This is `ringLabel` returning under a name that says where it is used.
     * It was removed when DanceRing and DanceRow stopped being controls — a
     * name on a role-less element is ignored by assistive tech, so it had no
     * consumer. A map pin IS a control (it is focusable and it opens the
     * preview), and a marker announces as one thing, so the whole night has to
     * arrive in one string again: when, where, with whom, and whether it is
     * still on. The status clause is what keeps a cancelled pin from sounding
     * identical to a normal one (AGENTS.md §2.6).
     */
    mapPinLabel: ({
      weekday,
      time,
      venue,
      instructor,
      status,
    }: {
      weekday: string;
      time: string;
      venue: string;
      instructor: string;
      status: string | null;
    }): string =>
      `הרקדה ב${weekday} בשעה ${time}, ${venue}, עם ${instructor}${
        status === null ? "" : `. ${status}`
      }`,
  },
} as const;
