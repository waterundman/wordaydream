# Icons placeholder

This directory should hold the application icon resources referenced from
`module.json5` as `$media:icon`. DevEco Studio expects the following PNG
assets here:

- `icon.png` — application icon (96×96 dp recommended source; DevEco will
  derive 72×72 / 96×96 / 192×192 rasterizations for the launcher)
- `foreground.png` / `background.png` — layered icon sources (optional
  for HarmonyOS 5.0+ adaptive icons)

Stage 1 deliberately does NOT ship binary PNGs to avoid committing large
assets that should instead be sourced from the design team. Until real
icons are added, DevEco Studio will warn about a missing `$media:icon`.

To unblock local builds, drop a 192×192 PNG named `icon.png` into this
folder. The path is git-ignored by `harmony/.gitignore` only for binaries
larger than 1 MB; small placeholder PNGs are fine to commit.

Stage 6 (visual polish) will provide production-ready icon assets.

## Stage 5 — Atomic Service icon resource manifest

Stage 5 declares the module as `type: "atomicService"` and adds the
`ohos.extension.share` metadata (pointing to `share_card.json`). Atomic
services have stricter icon requirements than a regular HAP entry. The
following PNG assets MUST be supplied (by the design team, then dropped
into this directory) before publishing to the HarmonyOS service center:

| Asset                    | Size        | Purpose                                                |
| ------------------------ | ----------- | ------------------------------------------------------ |
| `icon_72x72.png`         | 72 × 72 px  | Atomic service small icon (launcher / discovery grid)  |
| `icon_96x96.png`         | 96 × 96 px  | Atomic service medium icon (default `$media:icon`)     |
| `icon_168x168.png`       | 168 × 168 px| Atomic service large icon (service center detail page) |
| `icon_foreground.png`    | 108 × 108 px| Adaptive icon foreground layer (transparent background)|
| `icon_background.png`    | 108 × 108 px| Adaptive icon background layer (solid color / pattern) |
| `widget_icon.png`        | 32 × 32 px  | Service card icon (used by `ReviewCardWidget.ets`)     |

Until these PNGs are provided, the existing `$media:icon` placeholder
(Stage 1) continues to be referenced by `module.json5` and the
`EntryAbility` config. DevEco Studio will emit resource-missing warnings
but will not block local builds. Stage 6 will replace these with
production-ready assets.

The `share_card.json` `src` field (`./ets/widget/ReviewCardWidget.ets`)
also references `widget_icon.png` indirectly via the widget's own
`$media:widget_icon` declaration in Stage 6 — supply the PNG before
publishing the atomic service.

## Stage 6 — Service card icon resource manifest

Stage 6 implements the native ArkUI service card (`ReviewCardWidget.ets`)
and populates `form_config.json` with the `review_card` form. The service
card references the following PNG asset:

| Asset            | Size        | Purpose                                              |
| ---------------- | ----------- | ---------------------------------------------------- |
| `widget_icon.png`| 32 x 32 px  | Service card small icon (displayed in card header)   |

`widget_icon.png` (32x32 px, 用于服务卡片小图标) is consumed by
`ReviewCardWidget.ets` as `$media:widget_icon`. Until the design team
supplies the real PNG, DevEco Studio emits a resource-missing warning
but does not block local builds. The same asset is also referenced by
the Stage 5 `share_card.json` atomic-service share configuration.
