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
  heading:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
  label-small:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.43
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
  tool:
    backgroundColor: "transparent"
    textColor: "{colors.text-bright}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 10px 4px 8px"
    height: "32px"
  tool-hover:
    backgroundColor: "#9AA1AB14"
  tool-on:
    backgroundColor: "#4F9DFF24"
    textColor: "{colors.selection-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "32px"
  icon-tool:
    backgroundColor: "transparent"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.md}"
    padding: "6px"
    size: "32px"
  tool-disabled:
    textColor: "{colors.control-off}"
  segment:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label-small}"
    padding: "0 10px"
    height: "30px"
  segment-selected:
    backgroundColor: "#E6E8EB1A"
    textColor: "{colors.text-bright}"
    typography: "{typography.label-small}"
    padding: "0 10px"
    height: "30px"
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
    textColor: "{colors.page-black}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
  snackbar:
    backgroundColor: "{colors.surface-slate}"
    textColor: "{colors.text-bright}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
---


# Design System: J3D

## Overview

**Creative North Star: "The Inspection Bench"**

You put a part down on the bench to check it. The light is neutral, the edges are true and the callouts are exact.
Everything J3D draws serves that moment:

- The chrome is a quiet frame of cool near-black.
- The viewport is a soft graphite gradient that lets any part colour read.
- One blue, Selection Blue, marks only what the user is acting on: the selected part, the tool that's on, the measured
  edge.

The mood is **quiet, exact and workmanlike**. Precision shows in the numbers and in the drawing, not in decoration. The
numbers use tabular figures, always carry their unit, and give lengths to three decimals. The drawing puts near-black
BREP edges over every face.

Controls say what they do. Tools carry a label beside their icon wherever the window has room, and everything is
written in sentence case. Controls are square-cornered and stay grey until they're used. A tool that's on takes a blue
tint; a setting, such as the selection mode or the projection, is shown by a quietly raised segment, never in blue. The
density is a desktop tool's: a 48 px bar, a 320 px model list and 13 px detail text. It never gets crowded, though:
there's one row of tools in labelled groups, one floating panel and one view cube.

J3D is dark only (PRODUCT.md). The chrome is built from MudBlazor 9 components, restyled in `J3DTheme.cs` and
`app.css`. Material's UPPERCASE labels, round icon buttons and filled-blue toggles were replaced on purpose (2026-10-25),
so new work doesn't bring them back.

**Key Characteristics:**

- Dark only, with cool near-black neutrals: hue about 258°, OKLCH chroma under 0.02.
- One accent, Selection Blue, for what's being acted on. Settings and chrome are grey.
- Flat chrome separated by 1 px hairlines. Shadows only on what floats.
- The system font stack, in sentence case. Numbers in tabular figures, with their units.
- Labelled tools, square-cornered controls.
- The model is the brightest thing on screen.

## Colors

A cool, nearly colourless graphite palette with one blue that means "this is what you're acting on".

### Primary

- **Selection Blue** (#4F9DFF) marks everything the user is acting on. Against Chrome Graphite it reads at 6.4:1.
  - **In 3D:** the selection's tint and edges. The surface overlay is 45% opaque (22% on hover) and the edges are at
    full strength (60% on hover).
  - **In the drawer:** a selected tree node (16% fill, blue text), and a selected model (10% fill and a blue name).
  - **Tools and progress:** a tool that's on (a 14% tint behind a blue icon and label), and progress bars.
  - **Measurements:** lines, points and label borders.
  - **Elsewhere:** the drop overlay's dashed border, the view cube's hovered region, keyboard focus rings, and links
    under the pointer.

### Neutral

- **Page Black** (#121417): the page background, what shows before Blazor paints, and the text on the coral
  confirmation button.
- **Chrome Graphite** (#16191D): the app bar and the model drawer.
- **Surface Slate** (#1B1E23): menus, dialogs and snackbars. At 92% opacity it's also the floating panel, the projection
  switch and the measurement labels over the viewport.
- **Hairline** (#2A2F36): every divider and border, including the app bar's bottom edge, the drawer's edge, the rules
  between models and between toolbar groups, and the frames of segmented switches, the panel, snackbars and the
  format tag.
- **Text Bright** (#E6E8EB): primary text and icons (14.4:1 on Chrome Graphite).
- **Text Soft** (#C9CDD3): the drawer's text and model names.
- **Text Muted** (#9AA1AB, 6.8:1): secondary text, such as section heads, model details, unselected segments, the
  names in measurement rows, hints, key hints in menus, and the empty list's message.
- **Text Faint** (#5C636E): disabled text only. It reads at 2.9:1, so it isn't for anything the user must read.
- **Control Off** (#4A5059): disabled buttons and icons.

### Status

- **Warning Amber** (#FFB547): warnings only. It colours the warning icon on a model imported with warnings, the "wasn't
  kept" text, and a warning snackbar's icon.
- **Error Coral** (#FF6B6B): failures, an error snackbar's icon, and the destructive confirmation buttons (Delete, Clear
  all), which carry Page Black text.

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

**The One Blue Rule.** Selection Blue marks what the user is acting on (the selection, the hover, a tool that's on, the
measurement, progress, focus) and nothing else. A mode or setting that's merely chosen is never blue. There's no
decorative blue and no second accent.

**The Model Is Brightest Rule.** The chrome stays within the graphite neutrals, so the model is the brightest thing on
screen, in its own colours or in Part Grey. Bars, panels and snackbars are never filled with colour.

**The Status Means Status Rule.** Amber and coral appear only for warnings, failures and the destructive confirmation,
and in snackbars only on the icon. Never use them for emphasis or decoration.

## Typography

**Body Font:** the system UI stack: Segoe UI Variable, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue,
Arial, sans-serif. There's no display or mono face.

**Character:** the operating system's own UI face. Cross-origin isolation forbids web fonts, and a desktop tool should
read like the desktop it runs on. Hierarchy comes from size steps of 1–2 px and a single 500 weight, not from a
contrast between families.

### Hierarchy

- **Title** (500, 1.25rem/20px, 1.6): reserved for MudBlazor's dialog titles where they're used. The "J3D" wordmark is
  set at 1.125rem.
- **Heading** (500, 1rem/16px, 1.5): the empty view's prompt and confirmation titles.
- **Body** (400, 0.875rem/14px, 1.43): the default for menu items, dialog text and snackbars. Panel and card titles use
  it at 500.
- **Subtitle** (500, 14px, 1.57): section heads such as "Models", in Text Muted.
- **Body Dense** (400, 0.8125rem/13px, 1.43): model details, the tree, measurement rows, the Move heading and hints.
- **Label** (500, 14px, 1.43, sentence case, no extra tracking): tool and text-button labels, such as Import, Measure,
  Apply and Cancel. **Label Small** is the same at 13px, for segmented switches and small buttons.
- **Caption** (400, 0.75rem/12px): the model kind, menu captions (with 0.04em tracking) and key hints in menus.
- **Tag** (400, 0.6875rem/11px, 18px line, 0.04em tracking): the format tag (STEP, BREP, GLB…) and the feature cards'
  numbers.
- **Readout** and **Callout** (Body Dense and Caption with tabular figures): values in the panel and move fields, and
  the measurement labels in 3D.

### Named Rules

**The Sentence Case Rule.** Every label, button, heading and menu item is written in sentence case, as the README is.
Capitals are for names and formats (STEP, BREP, GLB) and keys (H, Shift+H), not for emphasis.

**The Tabular Figures Rule.** Every number the user reads as a value is set in tabular figures: measurements, move
fields and the labels in 3D. Its unit is written after it (mm, °, mm²). Lengths have three decimals, angles two, and
mesh values are prefixed ≈. In the panel, values are right-aligned, and whole parts of five or more digits are grouped
in thousands with a narrow space ("12 500.000 mm³"). A copied value keeps its plain form.

**The Weight Ceiling Rule.** 500 is the heaviest weight in the chrome. The only exception is the view cube's labels,
which are drawn on the canvas at 600. Emphasis comes from Text Bright against Text Muted, not from bold.

## Layout

- **Shell:** a 48 px app bar (with a 1 px hairline) runs across the top. A persistent 320 px model drawer sits on the
  left, clipped under the bar, and the menu button toggles it. The viewport fills the rest, edge to edge. The page
  itself never scrolls.
- **App bar:** the menu button and "J3D", then the toolbar, 16 px in, in five groups set off by hairlines:
  1. **Files and view:** Import, Export and Fit all.
  2. **Select:** the Model, Object and Feature switch.
  3. **Tools:** Measure, Move, Rotate (M17) and Origin frames.
  4. **Visibility:** Hide, Isolate and Show all.
  5. **History:** Undo and Redo.

  About sits at the far right. Controls within a group are 2 px apart, and each group has 8 px either side of its
  hairline.
- **Labels by width:** at 1,340 px and above, every tool and mode shows its label. Between 1,180 and 1,340 px Import,
  Export and Fit all drop theirs. Below 1,180 px every tool is a 32 px icon. (1,280 and 1,100 px until Rotate joined
  the tools in M17.) Visibility and History are icons at any
  width. Tooltips always name the action and its key. The bar stays on one line down to 900 px. There's no phone or
  tablet layout.
- **Viewport corners:**
  - **Top right:** the view cube (110 px, 12 px from the corner), with Home just left of it and the
    Orthographic | Perspective switch under it.
  - **Bottom left:** the selection, measure and move panel, 12 px in, up to 420 px wide. It scrolls when it's taller
    than the view allows.
  - **Bottom right:** snackbars.
- **Empty view:** while no model is open, a centred prompt says what to do: drop CAD or mesh files or use Import, which
  formats, and how the mouse moves the view. It gives way to the drop overlay while files are dragged.
- **Model rows:** 16 px left padding, a 34 px header line, the details beneath it, and the tree indented under its
  toggle. A hairline runs above each row.
- **Spacing:** steps of 2, 4, 6, 8, 12, 16 and 24 px. Most gaps are 4–8 px, insets 12 px, and row padding 16 px.

### Named Rules

**The One Bar Rule.** Every global tool lives in the app bar's single row, in its group, and the row stays on one line
from 900 px up. A new tool joins a group. It doesn't get a second row or a floating toolbar.

**The Fixed Corners Rule.** Each viewport corner has one owner: the view and its settings top right, the panel bottom
left, and snackbars bottom right. Nothing else goes in those corners.

**The Say It Rule.** A tool that's a verb of the product (Measure, Move, Origin frames, the selection modes) shows its
name whenever the window has room. An icon alone is for actions whose icon everyone already reads (hide, show, undo,
redo), and every icon has a tooltip naming the action and its key.

## Elevation & Depth

Flat by default. The app bar, the drawer, the model rows and the floating panel have no shadow. Hairline borders and
small tonal steps separate them: Page Black, then Chrome Graphite, then Surface Slate. Only what floats above the page
in the popover layer carries MudBlazor's Material shadows: menus, dialogs, snackbars and tooltips. The selection panel,
the projection switch and the measurement labels float over the 3D view on 92% opaque Surface Slate with a hairline,
not a shadow.

### Shadow Vocabulary

- **Menu** (`box-shadow: 0 5px 5px -3px rgba(0,0,0,.2), 0 8px 10px 1px rgba(0,0,0,.14), 0 3px 14px 2px
  rgba(0,0,0,.12)`, Material elevation 8): the toolbar's and the model list's menus, and the context menu.
- **Dialog** (`box-shadow: 0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px
  rgba(0,0,0,.12)`, elevation 24): the Delete and Clear all confirmations, and About.

### Named Rules

**The Shadows Only When Floating Rule.** A shadow means "this sits above the page and will go away": a menu, a dialog,
a snackbar. Bars, rows and panels stay flat, with hairlines.

## Shapes

Gently squared, with no round buttons:

- **6 px:** containers and controls share it. That covers menus, dialogs, snackbars, the floating panel, tool and icon
  buttons, segmented switches, and the model row's and tree toggle's buttons.
- **4 px:** small inline things, such as the format tag, the feature cards' numbers, the tree node highlight and its
  eye, measurement labels, move fields, copy buttons and Home.
- **8 px:** the drop overlay.

Borders are 1 px solid Hairline, apart from the accent borders:

- 1 px Selection Blue on measurement labels and on a focused move field;
- dashed for a measurement's reference label;
- a 2 px dashed outline on the drop overlay.

A tool that's on changes colour, not shape or size.

### Named Rules

**The Dashed Means Reference Rule.** A dashed Selection Blue outline means "the reference" (a measurement's first pick)
or "drop here". A solid outline is the current result.

## Components

### Buttons

Compact, labelled, and quiet until used.

- **Tools** (Import, Export, Fit all, Measure, Move, Origin frames): a 20 px Material outlined icon and a Label, 32 px
  tall with a 6 px radius, transparent with Text Bright. Hover adds a faint grey tint (8%). Below the width breakpoints
  they become 32 px icon-only squares.
- **Tool that's on** (Measure, Move, Origin frames): a 14% Selection Blue tint behind a blue icon and label, with
  `aria-pressed`. The tooltip changes to say how to stop, as in "Stop measuring (M or Esc)".
- **Icon tools** (Hide, Isolate, Show all, Undo, Redo): 32 px squares with a 6 px radius and 20 px icons, in Control Off
  when disabled. Each has an accessible name and a tooltip naming the key, as in "Hide the selection (H)".
- **Small buttons** in the drawer and panel (eyes, export, delete, copy, Clear all, the tree toggle): Text Muted at rest,
  Text Bright on hover, square-cornered.
- **Destructive confirmation:** filled Error Coral with Page Black Label text and an icon (Delete, Clear all), after a
  text Cancel that has focus when the dialog opens. These appear only in confirmation dialogs.
- **Apply** (Move panel): a small outlined button with a hairline border, beside the hint.

### Segmented switches

One-of-several settings: the selection level (Model, Object, Feature, each an icon and a label) in the toolbar, the
projection (Orthographic, Perspective) under the view cube, and the Move frame (Local, Parent, World) in the panel. A
hairline frame with a 6 px radius holds the choices, which are separated by hairlines. Unselected choices are Text Muted
on transparent. The chosen one is raised with a 10% Text Bright fill and Text Bright text, with no check mark and no
blue. They use Label Small.

### Chips / Tags

- **Format tag** (STEP, BREP, GLB…): outlined in 1 px Hairline with a 4 px radius, in Tag type and Text Muted, 20 px
  tall. It has no fill and no colour per format. The model kind (BREP or mesh) follows it in Caption.

### Model list and tree

- **Model rows:** each model's row has its name (Text Soft, 500, cut off with an ellipsis), its tag and its kind, then
  small icons for the eye, export and delete. A detail line beneath it, in Body Dense and Text Muted, gives the memory
  it takes ("64 MB in memory"), triangles and parts. While importing, the row shows a thin Selection Blue progress bar
  and a cancel button.
- **Empty list:** "No models yet. Import files, or drop them on the view." in Text Muted.
- **Tree:** set in Body Dense, with 26 px nodes and a 4 px radius highlight. Each node has an eye at the right: open,
  closed, or a dimmed (50%) open eye when only some of the parts below it are hidden. A hidden node's name drops to
  50% opacity.
- **Selected node:** a 16% Selection Blue fill and Selection Blue text.
- **Selected model** (Model mode): a 10% fill across the row and a blue name. The nodes inside it don't repeat the
  highlight.

### Floating panel

The selection, measurement and move panel at the viewport's bottom left. It's 92% Surface Slate with a 1 px Hairline,
a 6 px radius and 8 × 12 px padding, up to 420 px wide.

- **Title:** in Body at 500, with an ellipsis.
- **Path:** in Body Dense and Text Muted, as in "bracket.step › Bracket › Top".
- **Measurement and feature cards:** stacked, with hairlines between them. Feature cards carry their number in the order
  they were picked, in a small outlined box before the title. Each row pairs a name in Text Muted with a right-aligned
  tabular value. A part's own rows (volume, area, size, bounds) sit under the part's name, indented a step, rather than
  repeating it on every line.
- **Copy:** a 16 px copy icon appears at the end of a row under the pointer or with keyboard focus, only on rows with a
  number in them.
- **Move fields:** a heading says what the fields hold in the chosen frame: "Move by" in Local, "Position in its parent"
  or "Position in the world" otherwise. Then the fields, the hint, and Apply.
- **Hints:** at the bottom, in Body Dense and Text Muted.

It's a polite `role="status"` region, so changes are announced.

### Inputs / Fields

- **Move fields** (X, Y, Z, then Rx, Ry, Rz): three to a row, with the label on the left and the unit on the right. Each
  has a 1 px Hairline border, a 4 px radius, no fill, Text Bright text in tabular figures aligned right, and 3 × 6 px
  padding. Enter or Apply applies all six; Escape drops what's been typed.
- **Focus:** the border turns Selection Blue. There's no glow.

### Menus

Surface Slate, with a 6 px radius and the Menu shadow. Items are dense: 32 px tall, set in Body, with a 20 px outlined
icon. A command's key is written at the right in Caption and Text Muted, as in "Hide  H". A caption can head the menu,
in Caption with 0.04em tracking and Text Muted, as in "Export the selection". The context menu opens at the pointer.
Escape closes an open menu and does nothing else.

### Dialogs and snackbars

- **Confirmations** (Delete, Clear all): a Heading title, the question in Body naming its object ("Delete
  **part.stl**? Undo brings it back."), then Cancel and the coral confirmation. Cancel has focus, and Escape cancels.
- **About:** one Close button. Its links read as Text Bright with a quiet grey underline.
- **Snackbars:** Surface Slate with a hairline, a Text Bright message, and only the icon in the status colour (Text
  Muted for information).

### Measurement labels

HTML over the canvas that follows its anchor every frame. Each label is 92% Surface Slate with a 1 px Selection Blue
border (dashed for the reference), a 4 px radius and 2 × 6 px padding, set in Callout (12 px, tabular figures).
Measurement lines and points are drawn in Selection Blue, over the model.

### View cube, Home and projection

- **View cube:** top right, 110 px across, with faces in Cube Face, edge and corner bands in Viewport Top, and face
  labels (TOP, FRONT, RIGHT…) drawn on the canvas in Text Bright at weight 600. The region under the pointer turns
  Selection Blue. A click animates the camera to that view with camera-controls' default smoothing (0.25 s).
- **Home:** 28 px, just left of the cube, with a Text Muted icon. On hover or focus the icon turns Selection Blue on a
  12% blue tint.
- **Previous view and Next view** (M17): 28 px arrows left of Home, drawn as Home is; with nowhere to go they're Control
  Off and don't react. Their tooltips name them and their keys (`[` and `]`).
- **Projection:** an Orthographic | Perspective segmented switch under the cube, right-aligned with it, on 92% Surface
  Slate, at 12 px.

### Empty view

A centred prompt in the empty viewport: a 32 px outlined file icon in Text Muted, "Drop CAD or mesh files here, or use
Import" in Heading, the formats in Body Dense and Text Muted, and, after a gap, how the mouse moves the view
("Right-drag turns the view · left-drag pans · the wheel zooms"). It doesn't take pointer events.

## Do's and Don'ts

### Do:

- **Do** use Selection Blue (#4F9DFF) only for the selection, the hover, a tool that's on, measurement graphics,
  progress and focus.
- **Do** write every label in sentence case, and give each product verb (Measure, Move, Origin frames, Model, Object,
  Feature) its name beside its icon wherever there's room.
- **Do** keep the chrome in the graphite neutrals, and separate regions and toolbar groups with 1 px Hairline (#2A2F36)
  borders.
- **Do** give every icon-only button an accessible name and a tooltip naming the action and its key, and write the key
  beside menu commands too.
- **Do** show values in tabular figures with their unit: lengths to 3 decimals, angles to 2, ≈ before mesh values, and
  long whole numbers grouped in thousands for reading.
- **Do** float new viewport UI on 92% Surface Slate with a hairline and a 6 px radius, in the corner that owns it.
- **Do** open confirmations with Cancel focused, and say when Undo can bring something back.

### Don't:

- **Don't** add a light theme, a theme toggle, or light surfaces. PRODUCT.md makes dark only binding.
- **Don't** bring back UPPERCASE labels, round icon buttons or filled-blue toggles.
- **Don't** show a chosen setting or mode in blue; raise it quietly instead.
- **Don't** load fonts, icons or images from another origin. Cross-origin isolation blocks them, so use the system
  stack and bundled or inline assets.
- **Don't** add a second accent colour, gradients in the chrome, or coloured fills on bars, panels or snackbars.
- **Don't** mark a selected or active row with a coloured bar at its edge; tint it.
- **Don't** put shadows on bars, the drawer, rows or the floating panel. Shadows are for menus, dialogs and snackbars.
- **Don't** use Warning Amber or Error Coral for anything but warnings, failures and the destructive confirmation.
- **Don't** use Text Faint (#5C636E, 2.9:1) for text the user needs to read.
- **Don't** add a second toolbar row. The app bar stays on one line from 900 px up.
