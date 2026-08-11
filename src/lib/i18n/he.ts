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
  home: {
    heading: "הרקדות קרובות",
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
    },
  },
  nav: {
    /** Names the <nav> landmark, so a screen reader can jump straight to it. */
    label: "ניווט ראשי",
    map: "מפה",
    schedule: "לוח",
    profile: "שלי",
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
   * Managing the nights you already published — cancelling one, or moving it to
   * a different hour. One night at a time; changing the pattern of a whole
   * series is not something this screen offers.
   *
   * The words avoid "מופע", "אירוע" and "תזמון". A מרקיד says "הרקדה" and
   * "שעה" (AGENTS.md §2.8), and every control here says what it does to a
   * specific evening rather than naming a feature.
   */
  manageNights: {
    heading: "ההרקדות שלי",
    intro: "כאן אפשר לבטל הרקדה או לשנות את השעה שלה. הרוקדים יראו את השינוי מיד.",
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
      /** The stored date is unreadable — a server-side problem, not something to fix in the form. */
      date: "לא הצלחנו לקרוא את תאריך ההרקדה. אפשר לנסות שוב.",
      /** Somebody else's night, or one that no longer exists. */
      notYours: "ההרקדה הזאת אינה שלכם או שאינה קיימת יותר.",
      failed: "לא הצלחנו לשמור את השינוי. אפשר לנסות שוב.",
    },
  },
  /** Now a section inside /profile, not its own route or tab — see docs/decisions/0008. */
  favorites: {
    heading: "מועדפים",
  },
  profile: {
    heading: "שלי",
    /** The signed-in state. Says who you are, in the words a dancer gave us. */
    signedInAs: (phone: string): string => `מחוברים עם המספר ${phone}`,
    signOut: "יציאה מהחשבון",
    signingOut: "יוצאים…",
    /** Greets by the name the dancer chose, once there is a profile row. */
    greeting: (name: string): string => `שלום, ${name}`,
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
      failed: "לא הצלחנו לפרסם את ההרקדה. אפשר לנסות שוב.",
    },
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
    status: {
      moved: "הועבר",
      cancelled: "בוטל",
      /**
       * A night whose HOUR changed. Says the old time, not just "השתנה": a
       * dancer who already planned around 20:00 needs to recognise which
       * evening this is before they can act on it. The status stays
       * "scheduled" in the database — docs/decisions/0003 reserves "הועבר"
       * for a venue change — so this label is the only thing that tells them
       * (AGENTS.md §2.6, §10).
       */
      retimedFrom: (time: string): string => `הועבר מ-${time}`,
    },
    withInstructor: (instructor: string): string => `עם ${instructor}`,
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
