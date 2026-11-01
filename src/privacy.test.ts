import { describe, expect, it } from 'vitest'
import privacyDe from '../PRIVACY.de.md?raw'
import privacyEn from '../PRIVACY.md?raw'
import { parseMarkdown } from './markdown'

/** The privacy policy comes in English and German: both must say the same. */
describe('the privacy policy', () => {
  const shape = (source: string) =>
    parseMarkdown(source).map((block) =>
      block.kind === 'list' ? `list of ${block.items.length}` : `${block.kind}`,
    )

  it('has the same sections, paragraphs and lists in both languages', () => {
    expect(shape(privacyDe)).toEqual(shape(privacyEn))
  })

  it('names the contact address and the same date in both', () => {
    for (const text of [privacyEn, privacyDe]) expect(text).toContain('fipreroll+app@gmail.com')
    expect(privacyEn).toContain('In force from 1 November 2026')
    expect(privacyDe).toContain('Gültig ab 1. November 2026')
  })

  it('links only to https addresses', () => {
    for (const text of [privacyEn, privacyDe]) {
      for (const [, href] of text.matchAll(/\]\(([^)]+)\)/g)) expect(href).toMatch(/^https:\/\//)
    }
  })
})
