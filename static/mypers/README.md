# Public reference graphics

Graphics and Montserrat font files publicly served by https://mypers.ru, collected 2026-11-01 for the requested faithful local interface. All runtime file paths are local. No original JavaScript, trackers, API calls, credentials, or sessions are included.

- `asset-manifest.json`: exact original URL, local path, byte count, SHA-256 and native dimensions. Original broken public URLs are recorded as errors; no fabricated replacements are supplied.
- `selector-manifest.json` / `selector-manifest.csv`: original CSS selector, source graphic and complete declaration; includes original sprite/background positions and dimensions.
- `equipment-slots.json`: original equipment-slot class, exact Russian source label and coordinates.
- `slot-and-class-positions.json`: exact empty-slot, class, and gender sprite positions.
- `class-portraits.json`: portrait ID and class-icon ID mapping; these two ID systems differ in the original.
- `sprite-positions.json`: extracted original sprite position map for reference only.
- `skin-assets.css`: local fonts and the exact source `an` sprite rules returned by the current panel API, including the 13 default effects, plus state positions 1–21. Cards are not rendered. Page layout is defined separately.

Important source details:

- Equipment paper doll: `pn-hm.webp` is 582×212, male on the left and female on the right; original container is 292×213.
- Equipment frame: `tz.webp` is 319×457; original equipment-panel width is 317.
- Character panel: `eo.webp` is 320×646.
- Empty equipment sprite: `item-cells.webp` is 192×192.
- Class/gender sprite: `race-hii.webp` is 512×64; first row is selected, second row is default.
- The icon is `source_record.an`, as confirmed by the original `getSkillIlfNum()` implementation. `mi` is the translation key. For example sprite 2 is “Техника боя с копьем” (record 18); “Опека духов” (record 3) uses sprite 43. The 13 default record IDs are listed in `DEFAULT_PANEL_IDS` in `pwcalc/views.py`; the modern block excluded for Comeback 1.4.6 is not rendered.
- The original serves Montserrat weights 400, 600 and 800 plus italic 400; no 700 font file was confirmed.

Verification: 88 downloaded/cached assets matched their recorded SHA-256 and image/font signatures; all eight URLs referenced by `skin-assets.css` resolve to existing local files.
