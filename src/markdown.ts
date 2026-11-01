/**
 * The little Markdown the changelog uses, read into plain blocks for the About view: headings,
 * paragraphs and lists, with `code`, _emphasis_, **strong** and links inline. Nothing is taken
 * as HTML, and links go out only to https addresses, so the view builds its elements from text.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }

export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly content: Inline[] }
  | { readonly kind: 'paragraph'; readonly content: Inline[] }
  | { readonly kind: 'list'; readonly items: Inline[][] }

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let items: string[] | null = null
  const flush = () => {
    if (paragraph.length > 0)
      blocks.push({ kind: 'paragraph', content: inline(paragraph.join(' ')) })
    paragraph = []
    if (items) blocks.push({ kind: 'list', items: items.map(inline) })
    items = null
  }
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd()
    // Link definitions, such as `[0.1.0]: https://…`, are for GitHub's view of the file.
    if (/^\[[^\]]+\]:\s/.test(line)) continue
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const item = /^[-*]\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        content: inline(heading[2] ?? ''),
      })
    } else if (item) {
      if (paragraph.length > 0) flush()
      items ??= []
      items.push(item[1] ?? '')
    } else if (line.trim() === '') {
      flush()
    } else if (items && /^\s+/.test(raw)) {
      // A list item that goes on in the next line.
      items[items.length - 1] += ` ${line.trim()}`
    } else {
      if (items) flush()
      paragraph.push(line.trim())
    }
  }
  flush()
  return blocks
}

/** Text with `code`, _emphasis_, **strong** and [links](https://…) in it. */
export function inline(text: string): Inline[] {
  const parts: Inline[] = []
  const pattern =
    /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w])_([^_]+)_(?![\w])|\[([^\]]+)\](?:\(([^)\s]+)\))?/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) })
    last = at + match[0].length
    const [, code, strong, em, label, href] = match
    if (code !== undefined) parts.push({ kind: 'code', text: code })
    else if (strong !== undefined) parts.push({ kind: 'strong', text: strong })
    else if (em !== undefined) parts.push({ kind: 'em', text: em })
    else if (label !== undefined) {
      // [Unreleased] without an address is a heading's label: just its text.
      parts.push(
        href?.startsWith('https://')
          ? { kind: 'link', text: label, href }
          : { kind: 'text', text: label },
      )
    }
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
