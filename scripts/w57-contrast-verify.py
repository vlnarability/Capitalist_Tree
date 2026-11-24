#!/usr/bin/env python3
"""
W57 — verify the new palette endpoints produce WCAG-AA-compliant contrast
at every integer score (0-10), + emit the score=5 midpoint values for
globals.css.

The root cause of the contrast collapse: linear RGB lerp between a
dark-bg/light-text endpoint (brutalist) and a light-bg/dark-text endpoint
(floral) makes bg and text converge to the same mid-gray at score 5.

The fix: keep bg in the cream range (gray-cream -> warm-cream) and text in
the dark range at BOTH endpoints, so they never cross. The brutalist
aesthetic is conveyed through sickly accents + sharp corners + mono font,
not through a dark bg.
"""
import math

# --- New endpoints (the fix) ---
# Brutalist: gray-cream bg (colder/harsher than floral) + very dark text.
# Accents (leaf/bark/brass) stay sickly/dark — unchanged from the original.
BRUTALIST = {
    'parchment':   (200, 192, 168),  # gray-cream (colder than floral's warm cream)
    'parchment-2': (180, 172, 148),  # darker gray-cream for panels
    'parchment-3': (160, 152, 128),  # even darker for nested surfaces
    'ink':         (40, 32, 20),     # very dark — primary text
    'ink-2':       (75, 60, 40),     # dark — secondary text
    'ink-soft':    (85, 70, 48),     # dark — labels (passes 4.5:1 on cream)
    'leaf':        (138, 122, 58),   # keep — yellowed sickly canopy
    'leaf-2':      (154, 138, 74),   # keep
    'leaf-dark':   (106, 90, 42),    # keep
    'bark':        (58, 40, 24),     # keep
    'bark-2':      (42, 24, 8),      # keep
    'brass':       (74, 58, 26),     # keep
    'brass-2':     (58, 42, 16),     # keep
}

# Floral: warm-cream bg + dark text (the existing W48 field-journal palette).
# ink-soft DARKENED from (138,122,90) to (95,78,52) to pass 4.5:1 on cream.
FLORAL = {
    'parchment':   (244, 236, 216),  # warm cream (keep)
    'parchment-2': (235, 224, 196),  # keep
    'parchment-3': (220, 207, 176),  # keep
    'ink':         (58, 42, 26),     # keep
    'ink-2':       (107, 86, 64),    # keep (passes 4.5:1)
    'ink-soft':    (95, 78, 52),     # DARKEN from (138,122,90) -> passes 4.5:1
    'leaf':        (90, 122, 58),    # keep
    'leaf-2':      (122, 154, 74),   # keep
    'leaf-dark':   (58, 90, 42),     # keep
    'bark':        (107, 74, 42),    # keep
    'bark-2':      (74, 50, 24),     # keep
    'brass':       (138, 106, 42),   # keep
    'brass-2':     (106, 74, 24),    # keep
}

TOKENS = list(BRUTALIST.keys())


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def interpolate(score):
    t = max(0.0, min(1.0, score / 10.0))
    return {tok: lerp(BRUTALIST[tok], FLORAL[tok], t) for tok in TOKENS}


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb):
    r, g, b = rgb
    return 0.2126 * srgb_to_linear(r) + 0.7152 * srgb_to_linear(g) + 0.0722 * srgb_to_linear(b)


def contrast_ratio(fg, bg):
    l1 = relative_luminance(fg)
    l2 = relative_luminance(bg)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def main():
    print("=" * 78)
    print("W57 palette contrast verification")
    print("=" * 78)

    # The text tokens we care about (on parchment bg).
    text_tokens = ['ink', 'ink-2', 'ink-soft', 'brass-2', 'leaf-dark']
    aa_normal = 4.5
    aa_large = 3.0

    all_pass = True
    for score in range(0, 11):
        palette = interpolate(score)
        bg = palette['parchment']
        print(f"\n--- Score {score} (bg parchment = {bg}) ---")
        for tok in text_tokens:
            fg = palette[tok]
            ratio = contrast_ratio(fg, bg)
            # ink-soft is used for small (10-11px) labels -> needs 4.5:1.
            # brass-2 / leaf-dark are used for large text (text-2xl / bold) -> 3:1.
            threshold = aa_normal if tok in ('ink', 'ink-2', 'ink-soft') else aa_large
            status = "PASS" if ratio >= threshold else "FAIL"
            if ratio < threshold:
                all_pass = False
            print(f"  {tok:12s} {str(fg):16s} -> {ratio:5.2f}:1  "
                  f"(need {threshold}:1)  {status}")

    print("\n" + "=" * 78)
    print(f"Overall: {'ALL PASS' if all_pass else 'SOME FAIL'}")
    print("=" * 78)

    # Emit the score=5 midpoint values for globals.css.
    print("\n--- Score=5 midpoint values for globals.css :root ---")
    mid = interpolate(5)
    for tok in TOKENS:
        r, g, b = mid[tok]
        print(f"  --ct-{tok}: {r} {g} {b};")

    # Also emit the BRUTALIST + FLORAL endpoint values for palette.ts.
    print("\n--- BRUTALIST endpoint (palette.ts) ---")
    for tok in TOKENS:
        r, g, b = BRUTALIST[tok]
        print(f"  {tok:14s}: '{r} {g} {b}',")
    print("\n--- FLORAL endpoint (palette.ts) ---")
    for tok in TOKENS:
        r, g, b = FLORAL[tok]
        print(f"  {tok:14s}: '{r} {g} {b}',")


if __name__ == '__main__':
    main()
