import type { Direction } from '../input'
import { h } from './dom'

export interface Joystick {
  readonly element: HTMLElement
  /** Where the stick points, at most 1 long, or null while nobody holds it. */
  direction(): Direction
}

/**
 * A stick on the screen beside the arena: the thumb lands anywhere on the pad, and the
 * stick follows it up to the pad's edge. Letting go stops the dot.
 */
export function joystick(label: string): Joystick {
  const knob = h('span', { class: 'knob' })
  const base = h('span', { class: 'base' }, knob)
  const element = h('div', { class: 'joystick', role: 'application', ariaLabel: label }, base)
  let pointer: number | null = null
  let current: Direction = null

  const move = (event: PointerEvent) => {
    const box = base.getBoundingClientRect()
    const radius = Math.max(1, box.width / 2)
    const dx = (event.clientX - (box.left + radius)) / radius
    const dy = (event.clientY - (box.top + radius)) / radius
    const length = Math.hypot(dx, dy)
    const scale = length > 1 ? 1 / length : 1
    current = length < 0.08 ? null : { x: dx * scale, y: dy * scale }
    knob.style.transform = `translate(${dx * scale * 50}%, ${dy * scale * 50}%)`
  }
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return
    pointer = null
    current = null
    knob.style.transform = ''
    element.classList.remove('held')
  }

  element.addEventListener('pointerdown', (event) => {
    if (pointer !== null) return
    pointer = event.pointerId
    try {
      element.setPointerCapture(event.pointerId)
    } catch {}
    element.classList.add('held')
    move(event)
  })
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointer) move(event)
  })
  element.addEventListener('pointerup', release)
  element.addEventListener('pointercancel', release)
  element.addEventListener('lostpointercapture', release)

  return { element, direction: () => current }
}
