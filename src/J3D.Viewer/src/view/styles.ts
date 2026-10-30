/**
 * The styles of what the viewer adds to its host (D265): the view buttons, the drop overlay and the
 * measure labels. A page adopts them as a viewer starts, so nothing needs importing and no bundler needs
 * a CSS rule. They're plain `j3d-` classes of low specificity, which a page's own rules override.
 */
const ViewerCss = `
.j3d-viewer {
  position: relative;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.j3d-viewer > canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
}

/* Home sits at the top-left corner of the view cube (110 px, 12 px from the corner), with Previous view
   and Next view to its left (M17, D221). */
.j3d-home-button,
.j3d-view-button {
  position: absolute;
  top: 8px;
  right: 102px;
  width: 28px;
  height: 28px;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #9aa1ab;
  cursor: pointer;
}

.j3d-next-view {
  right: 134px;
}

.j3d-previous-view {
  right: 164px;
}

.j3d-home-button:hover,
.j3d-home-button:focus-visible,
.j3d-view-button:enabled:hover,
.j3d-view-button:focus-visible {
  color: #4f9dff;
  background: rgba(79, 157, 255, 0.12);
  outline: none;
}

.j3d-view-button:disabled {
  color: #4a5059;
  cursor: default;
}

.j3d-home-button svg,
.j3d-view-button svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: currentColor;
}

/* The compact layout's 80 px cube (M19, D240): Home and the arrows move in with it. */
@media (max-width: 899.98px), (max-height: 499.98px) {
  .j3d-home-button {
    right: 72px;
  }

  .j3d-next-view {
    right: 104px;
  }

  .j3d-previous-view {
    right: 134px;
  }
}

/* A finger's 48 px (D239, D240), a 20 px icon in each. */
@media (pointer: coarse) {
  .j3d-home-button,
  .j3d-view-button {
    top: 4px;
    right: 102px;
    width: 48px;
    height: 48px;
    padding: 14px;
  }

  .j3d-next-view {
    right: 150px;
  }

  .j3d-previous-view {
    right: 198px;
  }
}

@media (pointer: coarse) and (max-width: 899.98px), (pointer: coarse) and (max-height: 499.98px) {
  .j3d-home-button {
    right: 76px;
  }

  .j3d-next-view {
    right: 124px;
  }

  .j3d-previous-view {
    right: 172px;
  }
}

/* Without a view cube there's nothing to sit beside: the buttons go to the corner. */
.j3d-viewer--no-cube .j3d-home-button {
  right: 8px;
}

.j3d-viewer--no-cube .j3d-next-view {
  right: 40px;
}

.j3d-viewer--no-cube .j3d-previous-view {
  right: 70px;
}

/* The drag-and-drop overlay, shown while files are dragged over the view. */
.j3d-drop-overlay {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  margin: 12px;
  border: 2px dashed #4f9dff;
  border-radius: 8px;
  background: rgba(79, 157, 255, 0.08);
  pointer-events: none;
}

.j3d-viewer--drop .j3d-drop-overlay {
  display: flex;
}

.j3d-drop-overlay__label {
  padding: 10px 18px;
  border-radius: 6px;
  background: rgba(18, 20, 23, 0.85);
  color: #e6e8eb;
  font-size: 1rem;
}

/* Measurement labels (M7, D103): HTML over the canvas, moved by the viewer after every frame. */
.j3d-measure-labels {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.j3d-measure-label {
  position: absolute;
  left: 0;
  top: 0;
  padding: 2px 6px;
  border: 1px solid #4f9dff;
  border-radius: 4px;
  background: rgba(27, 30, 35, 0.92);
  color: #e6e8eb;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* The Measure tool's reference (D147): its own value, told apart from the result. */
.j3d-measure-label--reference {
  border-style: dashed;
}
`;

/** On the host while a viewer fills it. */
export const ViewerClass = 'j3d-viewer';

/** On the host of a viewer without a view cube (D267). */
export const NoCubeClass = 'j3d-viewer--no-cube';

let sheet: CSSStyleSheet | undefined;

/** Adds the viewer's styles to the document or shadow root `host` sits in, once. They stay for the page's life. */
export function adoptViewerStyles(host: HTMLElement): void {
  const root = host.getRootNode();
  const target = root instanceof ShadowRoot ? root : document;
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(ViewerCss);
  }
  if (!target.adoptedStyleSheets.includes(sheet)) {
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  }
}
