---
target: the whole J3D app
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\dev\\j3d\\src\\J3D.Web.Client\\Layout\\MainLayout.razor"
target_fingerprint: "sha256:55202d56d675ce3b405a3d582d3c7ccd5cf2cd01a547f2bf2b743ff79579ce53"
target_path: "C:\\dev\\j3d\\src\\J3D.Web.Client\\Layout\\MainLayout.razor"
timestamp: 2026-10-25T16-40-51Z
slug: src-j3d-web-client-layout-mainlayout-razor
---
Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Isolate leaves no visible state; "64 MB" is heap memory but reads as file size |
| 2 | Match system / real world | 3 | Origin frames uses a "3D rotate" glyph; tree toggle says Assembly/Hierarchy |
| 3 | User control and freedom | 3 | Delete dialog focuses DELETE (Enter deletes); Escape with the Export menu open clears the selection instead of closing the menu |
| 4 | Consistency and standards | 2 | Mixed UPPERCASE/sentence case; icon buttons round at rest, square when active; the eye means both "this node's visibility" and "Show all"; Export split across three places |
| 5 | Error prevention | 3 | Named confirmations, correct disabled states; undercut by default focus on Delete |
| 6 | Recognition rather than recall | 2 | 11 of 14 toolbar controls icon-only at 1280 px, all 14 below 1,100 px; menus don't show keys; no key list |
| 7 | Flexibility and efficiency | 3 | A key for everything; menus hide them; Isolate doesn't fit |
| 8 | Aesthetic and minimalist design | 3 | Two filled-blue settings glow at rest; panel repeats prefixes and 7 copy icons |
| 9 | Error recovery | 3 | Errors name file, format and cause |
| 10 | Help and documentation | 2 | Tooltips carry keys; no empty-state guidance or in-app key list |
| Total | | 27/40 | Acceptable (top of band) |

## Priority issues
1. [P1] Toolbar is mostly unlabelled glyphs; its widest control is the rarely used projection toggle (221 px). Fix: projection becomes a compact toggle by the view cube; labels for Measure, Move, Origin frames and Model/Object/Feature at >= 1,100 px; split Visibility (Hide, Isolate, Show all) from History (Undo, Redo); 36 px square icon buttons. (/impeccable layout, /impeccable clarify)
2. [P1] Inherited Material treatment breaks One Blue: filled white-on-#4F9DFF segments at 2.76:1 (detector-confirmed, text and icon), blue Info snackbar, UPPERCASE labels. Fix: sentence case via theme; toggle groups with hairline frames and a quiet selected segment (Text Bright on Surface Slate with a blue underline or 16% tint); neutral snackbars; 6 px squares at rest. (/impeccable quieter, /impeccable polish)
3. [P2] Feature/measure panel: repeated part prefixes, identical card titles, 7 copy icons, values left-aligned, no thousands grouping. Fix: group part properties, number feature cards, copy on hover/focus only, right-aligned grouped values. (/impeccable distill)
4. [P2] Move frames silently switch the fields between a delta (Local) and an absolute pose (Parent/World); Enter is the only way to apply. Fix: name the block per frame ("Move by" / "Position"), add Apply, sentence-case segments. (/impeccable clarify)
5. [P2] First run teaches nothing: blank viewport, "No models imported." at 2.9:1 (detector-confirmed), blue snackbar first; memory figure ambiguous. Fix: viewport empty-state prompt with formats and drop hint, Text Muted list text, "64 MB in memory". (/impeccable onboard)

## Detector
CLI: 0 anti-patterns, 4 advisories (Blazor error-UI template colours, 1rem drop-overlay label); .razor files get regex-only coverage. URL scan and in-page overlay (loaded via crossorigin=anonymous under COEP): 2 low-contrast findings, selected projection segment 2.8:1 and empty-list text 2.9:1. Missed by the detector: selected mode icon 2.76:1 (non-text), disabled icons 2.17:1 (exempt). Canvas not scannable; HTML measure labels pass (13.7:1).

## Persona red flags
- Owner (power user): menus hide keys; Isolate needs F after; STEP export only on the row icon; no key sheet.
- Accessibility: 2.8:1 toggles and Delete button; 2.9:1 empty text; mixed eye differs only by opacity; 1 px origin frame lines; focus on DELETE.
- First-timer (clone-and-run): no drop hint; first message is a blue snackbar; mode glyphs undecodable; right-drag rotates with no hint.

## Minor
About has both an x and CLOSE and is the bluest screen; Model mode double-paints row and tree; CLEAR ALL as loud as the heading; Delete dialog 199 px, no "Undo brings it back"; Import title duplicates its label; Export doesn't say selection until opened; Origin frames with nothing selected gives no hint; DESIGN.md's 40 px icon-button size is the narrow-bar size (48 px at full width).
