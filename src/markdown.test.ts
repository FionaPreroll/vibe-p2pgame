import { describe, expect, it } from 'vitest'
import changelog from '../CHANGELOG.md?raw'
import { inline, parseMarkdown } from './markdown'

describe('parseMarkdown', () => {
  it('reads headings, paragraphs and lists, and skips link definitions', () => {
    expect(
      parseMarkdown(
        [
          '# Changelog',
          '',
          'All changes',
          'are here.',
          '',
          '## [Unreleased]',
          '',
          '- One',
          '  going on',
          '- Two',
          '',
          '[Unreleased]: https://example.com/compare',
        ].join('\n'),
      ),
    ).toEqual([
      { kind: 'heading', level: 1, content: [{ kind: 'text', text: 'Changelog' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'All changes are here.' }] },
      { kind: 'heading', level: 2, content: [{ kind: 'text', text: 'Unreleased' }] },
      {
        kind: 'list',
        items: [[{ kind: 'text', text: 'One going on' }], [{ kind: 'text', text: 'Two' }]],
      },
    ])
  })

  it('reads the game’s own changelog', () => {
    const blocks = parseMarkdown(changelog)
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(blocks.some((b) => b.kind === 'heading' && b.level === 3)).toBe(true)
    expect(blocks.some((b) => b.kind === 'list')).toBe(true)
  })
})

describe('inline', () => {
  it('reads code, emphasis, strong and links', () => {
    expect(inline('Tap _Add player_, then **Start** `now`: see [docs](https://x.org/a).')).toEqual([
      { kind: 'text', text: 'Tap ' },
      { kind: 'em', text: 'Add player' },
      { kind: 'text', text: ', then ' },
      { kind: 'strong', text: 'Start' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'now' },
      { kind: 'text', text: ': see ' },
      { kind: 'link', text: 'docs', href: 'https://x.org/a' },
      { kind: 'text', text: '.' },
    ])
  })

  it('makes no link but to https, and leaves snake_case words alone', () => {
    expect(inline('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: 'x' },
      { kind: 'text', text: ')' },
    ])
    expect(inline('a <b>bold</b> my_snake_case')).toEqual([
      { kind: 'text', text: 'a <b>bold</b> my_snake_case' },
    ])
  })
})
