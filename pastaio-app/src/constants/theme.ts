// Pastaio design tokens.
//
// Ported from the HTML prototype's styles.css :root vars. RN doesn't do
// variable font axes reliably across iOS+Android, so what was
// `font-variation-settings: "opsz" 144, "SOFT" 100` in CSS becomes a specific
// static font cut here (see app/_layout.tsx for the seven font requires).
//
// Aperol is the v1 anchor color. The other palettes from the prototype
// (passata, ink) are not exposed.

export const colors = {
  // Surfaces — warm cream paper, single anchor accent
  paper:    '#EFE7D6',  // dominant
  paper2:   '#E6DCC6',  // recessed
  paperHi:  '#F5EEDF',  // lifted (cards, sheets)
  bone:     '#F8F2E5',  // lightest (modal/sheet bg, on-aperol text)

  // Ink stops — warm-bias near-black to a hairline
  ink:    '#1A1410',
  ink90:  '#2A211A',
  ink70:  '#4A3D31',
  ink50:  '#857B6E',  // the warm grey, used everywhere meta
  ink30:  '#B5AC9E',
  ink15:  '#D8D0BF',  // hairline solid

  // Anchor — aperol orange
  passata:     '#5C6A3A',
  passataDark: '#3F4A26',
  passataTint: '#DDE0CB',  // warm wash for warning bg

  // On-aperol — text/icons sitting on the aperol fill
  onAperol:       '#FFF5E8',
  onAperolMuted:  'rgba(255, 245, 232, 0.75)',
  onAperolDim:    'rgba(255, 245, 232, 0.55)',

  // Hairlines — RGBA over paper. Use these instead of trying to RGBA-darken paper.
  hairline:       'rgba(26, 20, 16, 0.10)',
  hairlineStrong: 'rgba(26, 20, 16, 0.20)',
} as const;

// Font families — names match expo-font keys in app/_layout.tsx.
//
// Display cuts are Fraunces 9pt (the looser, softer optical size). 9pt at
// display sizes approximates the prototype's opsz=144 + SOFT axes better
// than 144pt does. Counter-intuitive but visually true.
export const fonts = {
  displayItalicLight:   'Fraunces-Italic-Light',  // 300 italic — t-display
  displayItalic:        'Fraunces-Italic',        // 400 italic — t-display-roman, t-h1, t-h2
  displayRegular:       'Fraunces-Regular',       // 400 — t-num-roman
  sansRegular:          'Geist-Regular',
  sansMedium:           'Geist-Medium',
  sansSemibold:         'Geist-SemiBold',
  mono:                 'GeistMono-Regular',
} as const;

// Type primitives — flatten what was className+inline-style in the prototype
// into reusable RN TextStyle objects. Use via <Text variant="..."/>.
//
// Letter-spacing is absolute pixels in RN (CSS uses em). Numbers are computed
// from prototype's em values × the rough size in px.
export const type = {
  display: {
    fontFamily: fonts.displayItalicLight,
    fontSize: 44,
    lineHeight: 41,        // 0.92 * size
    letterSpacing: -1.1,   // -0.025em * 44
    color: colors.ink,
  },
  displayRoman: {
    fontFamily: fonts.displayItalic,
    fontSize: 22,
    lineHeight: 22,
    letterSpacing: -0.44,
    color: colors.ink,
  },
  h1: {
    fontFamily: fonts.displayItalic,
    fontSize: 36,
    lineHeight: 36,
    letterSpacing: -0.72,
    color: colors.ink,
  },
  h2: {
    fontFamily: fonts.displayItalic,
    fontSize: 24,
    lineHeight: 26,
    letterSpacing: -0.36,
    color: colors.ink,
  },
  h3: {
    fontFamily: fonts.sansSemibold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.08,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink70,
  },
  meta: {
    fontFamily: fonts.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.ink50,
  },
  // Mono — section labels, kickers, percentages. The "meta voice."
  mono: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.44,    // 0.04em * 11
    textTransform: 'uppercase' as const,
    color: colors.ink50,
  },
  num: {
    fontFamily: fonts.displayItalic,
    fontSize: 30,
    color: colors.passata,
  },
  numRoman: {
    fontFamily: fonts.displayRegular,
    fontSize: 30,
    color: colors.passata,
  },
} as const;

export const radii = {
  sharp: 0,
  sm: 2,
  md: 6,     // tighter than typical app radii — more editorial
  lg: 10,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const motion = {
  micro: 120,
  base:  200,
  page:  380,
  // Equivalent to cubic-bezier(0.2, 0.7, 0.2, 1).
  easing: [0.2, 0.7, 0.2, 1] as const,
} as const;

export type ColorKey = keyof typeof colors;
export type TypeKey = keyof typeof type;
