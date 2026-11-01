/**
 * Android's back button, in the app. Every screen says what it does: go where the screen's own
 * back button goes, be ignored, as in a game, where a slip of the thumb must not end it, or
 * leave the app, on the start screen. A dialog that can be cancelled closes first, outside a
 * game. In a browser, the button is the browser's own, and none of this runs.
 */
export type BackAction = (() => void) | 'ignore' | 'exit'

interface Dialog {
  isOpen(): boolean
  close(): void
}

let action: BackAction = 'ignore'
const dialogs: Dialog[] = []

/** What the back button does on the screen just shown (see `show` in src/ui/dom.ts). */
export function setBackAction(next: BackAction): void {
  action = next
}

/** Lets the back button cancel a dialog while it is open, outside a game. */
export function closeOnBack(isOpen: () => boolean, close: () => void): void {
  dialogs.push({ isOpen, close })
}

/** The back button was pressed: `exit` leaves the app. */
export function handleBack(exit: () => void): void {
  if (action === 'ignore') return
  while (dialogs.length > 0) {
    const top = dialogs.pop()
    if (top?.isOpen()) {
      top.close()
      return
    }
  }
  if (action === 'exit') exit()
  else action()
}
