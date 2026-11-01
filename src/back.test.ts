import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeOnBack, handleBack, setBackAction } from './back'

describe('the back button', () => {
  const exit = vi.fn()
  beforeEach(() => {
    exit.mockClear()
    // Dialogs from earlier tests are closed: a press drops them.
    setBackAction(() => {})
    handleBack(() => {})
  })

  it('goes where the screen says, or leaves the app on the start screen', () => {
    const home = vi.fn()
    setBackAction(home)
    handleBack(exit)
    expect(home).toHaveBeenCalledOnce()
    setBackAction('exit')
    handleBack(exit)
    expect(exit).toHaveBeenCalledOnce()
  })

  it('does nothing in a game, not even for a dialog', () => {
    const close = vi.fn()
    let open = true
    setBackAction('ignore')
    closeOnBack(() => open, close)
    handleBack(exit)
    expect(close).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    open = false
  })

  it('closes the newest open dialog first, then the screen goes back', () => {
    const settings = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    setBackAction(settings)
    closeOnBack(() => true, first)
    closeOnBack(() => false, second)
    handleBack(exit)
    // The second dialog was closed already some other way: the first one closes.
    expect(second).not.toHaveBeenCalled()
    expect(first).toHaveBeenCalledOnce()
    expect(settings).not.toHaveBeenCalled()
    handleBack(exit)
    expect(settings).toHaveBeenCalledOnce()
  })
})
