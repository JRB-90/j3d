---
name: J3D
description: A dark-only 3D CAD viewer that runs in the browser. One blue accent, flat graphite chrome, and the model as the subject.
colors:
  selection-blue: "#4F9DFF"
  warning-amber: "#FFB547"
  error-coral: "#FF6B6B"
  page-black: "#121417"
  chrome-graphite: "#16191D"
  surface-slate: "#1B1E23"
  hairline: "#2A2F36"
  text-bright: "#E6E8EB"
  text-soft: "#C9CDD3"
  text-muted: "#9AA1AB"
  text-faint: "#5C636E"
  control-off: "#4A5059"
  viewport-top: "#2A2F37"
  viewport-bottom: "#15181C"
  part-grey: "#B4B9C0"
  edge-black: "#0C0D0F"
  cube-face: "#3A404A"
typography:
  title:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.0075em"
  body:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "0.01071em"
  subtitle:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.57
    letterSpacing: "0.00714em"
  body-dense:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.75
    letterSpacing: "0.02857em"
  label-small:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.75
    letterSpacing: "0.02857em"
  caption:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.43
  tag:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "18px"
    letterSpacing: "0.04em"
  readout:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: '"tnum"'
  callout:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: '"tnum"'
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "50%"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  xxl: "24px"
components:
  app-bar:
    backgroundColor: "{colors.chrome-graphite}"
    textColor: "{colors.text-bright}"
    height: "48px"
  drawer:
    backgroundColor: "{colors.chrome-graphite}"
    textColor: "{colors.text-soft}"
    width: "320px"
  button-toolbar:
    backgroundColor: "transparent"
    textColor: "{colors.text-bright}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
    height: "36px"
  button-toolbar-hover:
    backgroundColor: "#9AA1AB0F"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.full}"
    padding: "8px"
    size: "40px"
  icon-button-active:
    backgroundColor: "transparent"
    textColor: "{colors.selection-blue}"
    rounded: "{rounded.md}"
    padding: "8px"
    size: "42px"
  icon-button-disabled:
    textColor: "{colors.control-off}"
  toggle-item:
    backgroundColor: "transparent"
    textColor: "{colors.selection-blue}"
    typography: "{typography.label-small}"
    padding: "3px"
  toggle-item-selected:
    backgroundColor: "{colors.selection-blue}"
    textColor: "#FFFFFF"
    typography: "{typography.label-small}"
    padding: "3px"
  format-tag:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.tag}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "20px"
  tree-node-selected:
    backgroundColor: "#4F9DFF29"
    textColor: "{colors.selection-blue}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.sm}"
    padding: "1px 4px"
    height: "26px"
  model-row-selected:
    backgroundColor: "#4F9DFF1A"
  floating-panel:
    backgroundColor: "#1B1E23EB"
    textColor: "{colors.text-bright}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  measure-label:
    backgroundColor: "#1B1E23EB"
    textColor: "{colors.text-bright}"
    typography: "{typography.callout}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  field:
    backgroundColor: "transparent"
    textColor: "{colors.text-bright}"
    typography: "{typography.readout}"
    rounded: "{rounded.sm}"
    padding: "3px 6px"
  menu:
    backgroundColor: "{colors.surface-slate}"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.md}"
  menu-item:
    textColor: "{colors.text-bright}"
    typography: "{typography.body}"
    padding: "2px 12px"
    height: "32px"
  dialog:
    backgroundColor: "{colors.surface-slate}"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.md}"
  button-danger:
    backgroundColor: "{colors.error-coral}"
    textColor: "#FFFFFF"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
---

# Design System: J3D

## Overview

**Creative North Star: "The Inspection Bench"**

You put a part down on the bench to check it. The light is neutral, the edges are true and the callouts are exact.
Everything J3D draws serves that moment:

- The chrome is a quiet frame of cool near-black.
- The viewport is a soft graphite gradient that lets any part colour read.
- One blue, Selection Blue, marks only what the user is acting on: the selected part, the active tool, the measured
  edge.

The mood is **quiet, exact and workmanlike**. Precision shows in the numbers and in the drawing, not in decoration. The
numbers use tabular figures, always carry their unit, and give lengths to three decimals. The drawing puts near-black
BREP edges over every face.

Controls are compact and stay quiet until they're active. They sit in grey at rest; a tool that's on takes the blue
outline. The density is a desktop tool's: a 48 px bar, a 320 px model list and 13 px detail text. It never gets
crowded, though: there's one row of tools, one floating panel and one view cube.

J3D is dark only (PRODUCT.md). The chrome is MudBlazor 9's Material components on a custom dark palette. Some of the
look comes from the library rather than from a decision: UPPERCASE button labels, round icon buttons, and white text on
blue toggles. This file marks those as **inherited**. New work matches them, but a later refinement may replace them.

**Key Characteristics:**

- Dark only, with cool near-black neutrals: hue about 258°, OKLCH chroma under 0.02.
- One accent, Selection Blue. Everything else in the chrome is grey.
- Flat chrome separated by 1 px hairlines. Shadows only on what floats.
- The system font stack. Numbers in tabular figures, with their units.
- The model is the brightest thing on screen.

## Colors

A cool, nearly colourless graphite palette with one blue that means "this is what you're acting on".

### Primary

- **Selection Blue** (#4F9DFF) marks everything the user is acting on. Against Chrome Graphite it reads at 6.4:1.
  - **In 3D:** the selection's tint and edges. The surface overlay is 45% opaque (22% on hover) and the edges are at
    full strength (60% on hover).
  - **In the drawer:** a selected tree node (16% fill, blue text), and a selected model (10% fill plus a 3 px bar
    inside its left edge).
  - **Tools and progress:** an active tool's outline, the selected toggle segment, and progress bars.
  - **Measurements:** lines, points and label borders.
  - **Elsewhere:** the drop overlay's dashed border, and the view cube's hovered region.

### Neutral

- **Page Black** (#121417): the page background, and what shows before Blazor paints.
- **Chrome Graphite** (#16191D): the app bar and the model drawer.
- **Surface Slate** (#1B1E23): menus and dialogs. At 92% opacity it's also the floating panel and the measurement
  labels over the viewport.
- **Hairline** (#2A2F36): every divider and border, including the app bar's bottom edge, the drawer's edge, the rules
  between models, the toolbar group separator, and the outlines of the panel and the format tag.
- **Text Bright** (#E6E8EB): primary text and icons (14.4:1 on Chrome Graphite).
- **Text Soft** (#C9CDD3): the drawer's text and model names.
- **Text Muted** (#9AA1AB, 6.8:1): secondary text, such as section heads, model details, the names in measurement
  rows, hints, and the Home button.
- **Text Faint** (#5C636E): disabled text. It reads at only 2.9:1, so it isn't for anything the user must read. The
  empty list's "No models imported." uses it today.
- **Control Off** (#4A5059): disabled buttons and icons.

### Status

- **Warning Amber** (#FFB547): warnings only. It colours the warning icon on a model imported with warnings, the "wasn't
  kept" text, and warning snackbars.
- **Error Coral** (#FF6B6B): failures, error snackbars, and the destructive confirmation buttons (Delete, Clear all).

MudBlazor's theme also defines Secondary (#FFB547, the same as warning), Tertiary (#5FD3BC), Success (#5FD38D) and Info
(#4F9DFF). The UI never uses them by name, so they're left out of the tokens.

### The scene

- **Viewport gradient:** Viewport Top (#2A2F37) to Viewport Bottom (#15181C), from top to bottom. The renderer clears to
  transparent over it, and the viewport's CSS paints the same gradient so nothing flashes before the first frame.
- **Part Grey** (#B4B9C0): parts and meshes without colours of their own. Otherwise faces take the file's colours,
  translucency included. All surfaces share one finish (metalness 0.05, roughness 0.55) under a headlight.
- **Edge Black** (#0C0D0F): the BREP edges over every face of a CAD model.
- **View cube:** faces in Cube Face (#3A404A), edge and corner bands in Viewport Top, labels in Text Bright, and the
  hovered region in Selection Blue.
- **Axes:** origin frames draw X, Y and Z in red, green and blue (linear vertex colours 0.95/0.26/0.26,
  0.30/0.85/0.30 and 0.30/0.55/1.00). The Move triad uses three.js TransformControls' own colours.

### Named Rules

**The One Blue Rule.** Selection Blue marks what the user is acting on (the selection, the hover, the active tool or
mode, the measurement, progress) and nothing else. There's no decorative blue and no second accent.

**The Model Is Brightest Rule.** The chrome stays within the graphite neutrals, so the model is the brightest thing on
screen, in its own colours or in Part Grey. Bars and panels are never filled with colour.

**The Status Means Status Rule.** Amber and coral appear only for warnings, failures and the destructive confirmation.
Never use them for emphasis or decoration.

## Typography

**Body Font:** the system UI stack: Segoe UI Variable, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue,
Arial, sans-serif. There's no display or mono face.

**Character:** the operating system's own UI face. Cross-origin isolation forbids web fonts, and a desktop tool should
read like the desktop it runs on. Hierarchy comes from size steps of 1–2 px and a single 500 weight, not from a
contrast between families.

### Hierarchy

- **Title** (500, 1.25rem/20px, 1.6): "J3D" in the app bar. It's the only large text.
- **Body** (400, 0.875rem/14px, 1.43): the default for menu items and dialog text. Panel and card titles use it at 500.
- **Subtitle** (500, 14px, 1.57): section heads such as "Models", in Text Muted.
- **Body Dense** (400, 0.8125rem/13px, 1.43): model details, the tree, measurement rows and hints.
- **Label** (500, 14px, 0.02857em tracking, UPPERCASE, inherited): text buttons such as Import, Export, Fit all and the
  dialogs' buttons. **Label Small** is the same at 13px, for small buttons and toggle segments.
- **Caption** (400, 0.75rem/12px): the model kind and menu captions. Menu captions add 0.04em tracking.
- **Tag** (400, 0.6875rem/11px, 18px line, 0.04em tracking): the format tag (STEP, BREP, GLB…).
- **Readout** and **Callout** (Body Dense and Caption with tabular figures): values in the panel and move fields, and
  the measurement labels in 3D.

### Named Rules

**The Tabular Figures Rule.** Every number the user reads as a value is set in tabular figures: measurements, move
fields and the labels in 3D. Its unit is written after it (mm, °, mm²). Lengths have three decimals, angles two, and
mesh values are prefixed ≈. Values in fields are right-aligned.

**The Weight Ceiling Rule.** 500 is the heaviest weight in the chrome. The only exception is the view cube's labels,
which are drawn on the canvas at 600. Emphasis comes from Text Bright against Text Muted, not from bold.

## Layout

- **Shell:** a 48 px app bar (with a 1 px hairline) runs across the top. A persistent 320 px model drawer sits on the
  left, clipped under the bar, and the menu button toggles it. The viewport fills the rest, edge to edge. The page
  itself never scrolls.
- **App bar:** the menu button and "J3D", then the toolbar, 24 px in, in this order:
  1. Import, Export and Fit all.
  2. The projection toggle.
  3. The selection-mode switch.
  4. Measure, Move and Origin frames.
  5. A group set off by a hairline: Hide, Isolate, Show all, Undo and Redo.

  About sits at the far right. Controls are 4 px apart, and groups 12 px apart.
- **Viewport corners:** the view cube is top right (110 px, 12 px from the corner), with Home just left of it. The
  selection, measure and move panel is bottom left: 12 px in, up to 420 px wide, and it scrolls when it's taller than
  the view allows. Snackbars are bottom right.
- **Model rows:** 16 px left padding, a 34 px header line, the details beneath it, and the tree indented under its
  toggle. A hairline runs above each row.
- **Spacing:** steps of 2, 4, 6, 8, 12, 16 and 24 px. Most gaps are 4–8 px, insets 12 px, and row padding 16 px.
- **Narrow windows** (below 1,100 px):
  - Import, Export and Fit all drop their labels and become 40 px icon buttons. Their tooltips stay.
  - The projection toggle shortens to Ortho and Persp.
  - Group gaps tighten to 6 px.

  The bar stays on one line down to 900 px. There's no phone or tablet layout.

### Named Rules

**The One Bar Rule.** Every global tool lives in the app bar's single row, which stays on one line from 900 px up. A
new tool joins a group. It doesn't get a second row or a floating toolbar.

**The Fixed Corners Rule.** Each viewport corner has one owner: the view cube top right, the panel bottom left, and
snackbars bottom right. Nothing else goes in those corners.

## Elevation & Depth

Flat by default. The app bar, the drawer, the model rows and the floating panel have no shadow. Hairline borders and
small tonal steps separate them: Page Black, then Chrome Graphite, then Surface Slate. Only what floats above the page
in the popover layer carries MudBlazor's Material shadows: menus, dialogs, snackbars and tooltips. The selection panel
and measurement labels float over the 3D view on 92% opaque Surface Slate with a hairline, not a shadow.

### Shadow Vocabulary

- **Menu** (`box-shadow: 0 5px 5px -3px rgba(0,0,0,.2), 0 8px 10px 1px rgba(0,0,0,.14), 0 3px 14px 2px
  rgba(0,0,0,.12)`, Material elevation 8): the toolbar's and the model list's menus, and the context menu.
- **Dialog** (`box-shadow: 0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px
  rgba(0,0,0,.12)`, elevation 24): the Delete and Clear all confirmations, and About.

### Named Rules

**The Shadows Only When Floating Rule.** A shadow means "this sits above the page and will go away": a menu, a dialog,
a snackbar. Bars, rows and panels stay flat, with hairlines.

## Shapes

Gently squared:

- **6 px:** containers and buttons share it. That covers menus, dialogs, the floating panel, text buttons, toggle
  groups and an active tool's outline.
- **4 px:** small inline things, such as the format tag, the tree node highlight, measurement labels, move fields and
  Home.
- **8 px:** the drop overlay.
- **Round:** icon buttons at rest (inherited from MudBlazor). When their tool is on, they become 6 px squares with an
  outline.

Borders are 1 px solid Hairline, apart from the accent borders:

- 1 px Selection Blue on active tools, toggle groups and measurement labels;
- dashed for a measurement's reference label;
- a 2 px dashed outline on the drop overlay.

### Named Rules

**The Dashed Means Reference Rule.** A dashed Selection Blue outline means "the reference" (a measurement's first pick)
or "drop here". A solid outline is the current result or the active state.

## Components

### Buttons

Compact and quiet until active.

- **Toolbar text buttons** (Import, Export, Fit all): transparent, in Text Bright, set in Label (UPPERCASE, inherited),
  36 px tall with a 6 px radius and the icon on the left. They take a faint grey tint on hover. Below 1,100 px they
  become 40 px icon-only buttons.
- **Icon buttons:** 40 px and round, with 24 px Material icons in Text Bright, and Control Off when disabled. The model
  list uses the small size. Each has an accessible name and a tooltip or title. In the toolbar the tooltip names the
  key, as in "Hide selection (H)".
- **Tool toggles** (Measure, Move, Origin frames): when on, the icon turns Selection Blue inside a 1 px Selection Blue
  outline with a 6 px radius, and the button sets `aria-pressed`. The tooltip changes to say how to stop, as in "Stop
  measuring (M)". The outline makes an active button 42 px, 2 px larger than its neighbours.
- **Destructive confirmation:** filled Error Coral with white Label text and an icon (Delete, Clear all), next to a text
  Cancel. These appear only in confirmation dialogs.

### Toggle groups

Segmented switches for one-of-several modes: the projection (Orthographic or Perspective) and the selection level
(Model, Object or Feature, icons only). Each group has a 1 px Selection Blue frame with a 6 px radius. Unselected
segments show Selection Blue text on transparent. The selected segment is filled Selection Blue with white text
(inherited, and only 2.8:1). They use the small size, in Label Small.

### Chips / Tags

- **Format tag** (STEP, BREP, GLB…): outlined in 1 px Hairline with a 4 px radius, in Tag type and Text Muted, 20 px
  tall. It has no fill and no colour per format. The model kind (BREP or mesh) follows it in Caption.

### Model list and tree

- **Model rows:** each model's row has its name (Text Soft, 500, cut off with an ellipsis), its tag and its kind, then
  small icons for the eye, export and delete. A detail line beneath it, in Body Dense and Text Muted, gives size,
  triangles and parts. While importing, the row shows a thin Selection Blue progress bar and a cancel button.
- **Tree:** set in Body Dense, with 26 px nodes and a 4 px radius highlight. Each node has an eye at the right: open,
  closed, or a dimmed (50%) open eye when only some of the parts below it are hidden. A hidden node's name drops to
  50% opacity.
- **Selected node:** a 16% Selection Blue fill and Selection Blue text.
- **Selected model** (Model mode): a 10% fill and a 3 px Selection Blue bar inside its left edge.

### Floating panel

The selection, measurement and move panel at the viewport's bottom left. It's 92% Surface Slate with a 1 px Hairline,
a 6 px radius and 8 × 12 px padding, up to 420 px wide.

- **Title:** in Body at 500, with an ellipsis.
- **Path:** in Body Dense and Text Muted, as in "bracket.step › Bracket › Top".
- **Measurement cards:** stacked, with hairlines between them. Each row pairs a name in Text Muted with a tabular
  value and a copy button at 60% opacity.
- **Hints:** at the bottom, in Body Dense and Text Muted.

It's a polite `role="status"` region, so changes are announced.

### Inputs / Fields

- **Move fields** (X, Y, Z, then Rx, Ry, Rz): three to a row, with the label on the left and the unit on the right. Each
  has a 1 px Hairline border, a 4 px radius, no fill, Text Bright text in tabular figures aligned right, and 3 × 6 px
  padding. Enter applies the values.
- **Focus:** the border turns Selection Blue. There's no glow or ring.

### Menus

Surface Slate, with a 6 px radius and the Menu shadow. Items are dense: 32 px tall, 2 × 12 px padding, set in Body. A
caption can head the menu, in Caption with 0.04em tracking and Text Muted, as in "Export the selection". The context
menu opens at the pointer.

### Measurement labels

HTML over the canvas that follows its anchor every frame. Each label is 92% Surface Slate with a 1 px Selection Blue
border (dashed for the reference), a 4 px radius and 2 × 6 px padding, set in Callout (12 px, tabular figures).
Measurement lines and points are drawn in Selection Blue, over the model.

### View cube and Home

- **View cube:** top right, 110 px across, with faces in Cube Face, edge and corner bands in Viewport Top, and face
  labels (TOP, FRONT, RIGHT…) drawn on the canvas in Text Bright at weight 600. The region under the pointer turns
  Selection Blue. A click animates the camera to that view with camera-controls' default smoothing (0.25 s).
- **Home:** 28 px, just left of the cube, with a Text Muted icon. On hover or focus the icon turns Selection Blue on a
  12% blue tint.

## Do's and Don'ts

### Do:

- **Do** use Selection Blue (#4F9DFF) only for the selection, the hover, an active tool or mode, measurement graphics
  and progress.
- **Do** keep the chrome in the graphite neutrals, and separate regions with 1 px Hairline (#2A2F36) borders.
- **Do** give every icon-only button an accessible name and a tooltip. In the toolbar, the tooltip names the key, as
  in "Fit all (F)".
- **Do** show values in tabular figures with their unit: lengths to 3 decimals, angles to 2, and ≈ before mesh values.
- **Do** float new viewport UI on 92% Surface Slate with a hairline and a 6 px radius, in a corner no one owns yet.
- **Do** match MudBlazor's inherited defaults (UPPERCASE labels, round icon buttons) in new controls, until a
  refinement replaces them everywhere at once.

### Don't:

- **Don't** add a light theme, a theme toggle, or light surfaces. PRODUCT.md makes dark only binding.
- **Don't** load fonts, icons or images from another origin. Cross-origin isolation blocks them, so use the system
  stack and bundled or inline assets.
- **Don't** add a second accent colour, gradients in the chrome, or coloured fills on bars and panels.
- **Don't** put shadows on bars, the drawer, rows or the floating panel. Shadows are for menus, dialogs and snackbars.
- **Don't** use Warning Amber or Error Coral for anything but warnings, failures and the destructive confirmation.
- **Don't** use Text Faint (#5C636E, 2.9:1) for text the user needs to read.
- **Don't** add a second toolbar row. The app bar stays on one line from 900 px up.
