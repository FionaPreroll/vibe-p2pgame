import { type Block, type Inline, parseMarkdown } from '../markdown'
import { h } from './dom'

/** Markdown read by src/markdown.ts, as elements built from text: no HTML passes through. */

/** A document such as the privacy policy, without its title, which the screen shows. */
export function documentView(source: string): HTMLElement {
  const blocks = parseMarkdown(source).filter((b) => !(b.kind === 'heading' && b.level === 1))
  return h('div', { class: 'document' }, ...blocks.map(blockNode))
}

export function blockNode(block: Block): Node {
  if (block.kind === 'heading')
    return h(block.level <= 2 ? 'h3' : 'h4', {}, ...block.content.map(inlineNode))
  if (block.kind === 'paragraph') return h('p', {}, ...block.content.map(inlineNode))
  return h('ul', {}, ...block.items.map((item) => h('li', {}, ...item.map(inlineNode))))
}

export function inlineNode(part: Inline): Node {
  switch (part.kind) {
    case 'text':
      return document.createTextNode(part.text)
    case 'code':
      return h('code', {}, part.text)
    case 'em':
      return h('em', {}, part.text)
    case 'strong':
      return h('strong', {}, part.text)
    case 'link':
      return link(part.href, part.text)
  }
}

/** A link that opens outside the game, in the browser. */
export function link(href: string, text: string): HTMLAnchorElement {
  return h('a', { href, target: '_blank', rel: 'noopener', textContent: text })
}
