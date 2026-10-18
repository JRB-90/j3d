/**
 * Saves bytes as a file through a `blob:` URL and an `<a download>` (M9, D120), which every browser
 * supports; where the file goes is the browser's choice.
 */
export function saveFile(bytes: BlobPart, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Not at once: a browser may start reading the URL only after the click has returned.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Resolves once the browser has had a chance to paint (a busy button, say) before long synchronous
 * work: after the next frame, or after 100 ms where frames don't run (a hidden page).
 */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100);
  });
}
