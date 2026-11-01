import changelog from '../../CHANGELOG.md?raw'
import { t } from '../i18n'
import { type Block, type Inline, parseMarkdown } from '../markdown'
import { isApp } from '../native'
import { h, show } from './dom'

export const REPOSITORY = 'https://github.com/FionaPreroll/vibe-p2pgame'

/** A package in the bundle, as the build lists it in licenses.json (see tools/licenses.ts). */
interface License {
  readonly name: string
  readonly version: string
  readonly license: string
  readonly homepage: string | null
  readonly text: string
}

/** What the Android app carries besides the web game, from its Gradle files. */
const NATIVE: readonly { name: string; license: string; url: string }[] = [
  {
    name: 'Capacitor for Android',
    license: 'MIT',
    url: 'https://github.com/ionic-team/capacitor',
  },
  {
    name: 'Capacitor App plugin',
    license: 'MIT',
    url: 'https://github.com/ionic-team/capacitor-plugins',
  },
  {
    name: 'Capawesome ML Kit Barcode Scanning plugin',
    license: 'Apache-2.0',
    url: 'https://github.com/capawesome-team/capacitor-mlkit',
  },
  {
    name: 'Apache Cordova for Android',
    license: 'Apache-2.0',
    url: 'https://github.com/apache/cordova-android',
  },
  {
    name: 'AndroidX (AppCompat, Core, Activity, Fragment, CoordinatorLayout, WebKit, CameraX, SplashScreen)',
    license: 'Apache-2.0',
    url: 'https://developer.android.com/jetpack/androidx',
  },
  {
    name: 'Guava ListenableFuture',
    license: 'Apache-2.0',
    url: 'https://github.com/google/guava',
  },
  {
    name: 'Google ML Kit Barcode Scanning and Google code scanner',
    license: 'ML Kit Terms of Service',
    url: 'https://developers.google.com/ml-kit/terms',
  },
  {
    name: 'Google Play services Nearby Connections',
    license: 'Android Software Development Kit License',
    url: 'https://developer.android.com/studio/terms',
  },
]

/**
 * About the game: which build this is, what changed from version to version (the changelog,
 * in English), and the other people's code inside, with their licenses.
 */
export function aboutScreen(onBack: () => void): void {
  const licenses = h('div', { class: 'licenses' }, h('p', { class: 'muted' }, '…'))
  const web = { commit: __BUILD__.commit, date: __BUILD__.time.slice(0, 10) }
  const build = h('p', { class: 'muted' }, t('aboutBuild', web))
  // In the app, its own build number too, as the updates count by it.
  if (isApp()) {
    void import('../updates')
      .then(({ AppUpdater }) => AppUpdater.info())
      .then(({ build: number }) => {
        build.textContent = t('aboutAppBuild', { ...web, build: number })
      })
      .catch(() => {})
  }
  show(
    h(
      'div',
      { class: 'screen about' },
      h(
        'header',
        {},
        h('button', {
          type: 'button',
          class: 'icon',
          ariaLabel: t('back'),
          textContent: '←',
          onclick: onBack,
        }),
        h('h2', {}, t('aboutTitle')),
      ),
      h('p', {}, t('tagline')),
      build,
      h('p', {}, link(REPOSITORY, t('aboutSource'))),
      h('h3', {}, t('changelogTitle')),
      t('changelogNote') ? h('p', { class: 'muted' }, t('changelogNote')) : null,
      changelogView(changelog),
      h('h3', {}, t('licensesTitle')),
      h('p', { class: 'muted' }, t('licensesNote')),
      licenses,
      isApp() ? h('p', { class: 'muted' }, t('licensesNative')) : null,
      isApp() ? nativeList() : null,
    ),
    onBack,
  )
  void loadLicenses().then((list) => {
    licenses.replaceChildren(
      list === null
        ? h('p', { class: 'muted' }, t('licensesMissing'))
        : h('ul', { class: 'license-list' }, ...list.map(licenseItem)),
    )
  })
}

/** The changelog, a version to a section, the newest open. */
export function changelogView(source: string): HTMLElement {
  const sections: { title: Inline[]; blocks: Block[] }[] = []
  for (const block of parseMarkdown(source)) {
    if (block.kind === 'heading' && block.level === 2)
      sections.push({ title: block.content, blocks: [] })
    else if (block.kind !== 'heading' || block.level > 2) sections.at(-1)?.blocks.push(block)
  }
  // Nothing unreleased yet: that section stays out.
  const shown = sections.filter((section) => section.blocks.length > 0)
  return h(
    'div',
    { class: 'changelog' },
    ...shown.map((section, index) =>
      h(
        'details',
        { open: index === 0 },
        h(
          'summary',
          {},
          // What is not in a numbered version yet is what players have now.
          ...(sectionTitle(section.title) === 'Unreleased'
            ? [t('changelogUnreleased')]
            : section.title.map(inlineNode)),
        ),
        ...section.blocks.map(blockNode),
      ),
    ),
  )
}

function sectionTitle(title: Inline[]): string {
  return title.map((part) => part.text).join('')
}

function blockNode(block: Block): Node {
  if (block.kind === 'heading') return h('h4', {}, ...block.content.map(inlineNode))
  if (block.kind === 'paragraph') return h('p', {}, ...block.content.map(inlineNode))
  return h('ul', {}, ...block.items.map((item) => h('li', {}, ...item.map(inlineNode))))
}

function inlineNode(part: Inline): Node {
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

function link(href: string, text: string): HTMLAnchorElement {
  return h('a', { href, target: '_blank', rel: 'noopener', textContent: text })
}

/** The list the build wrote, checked; null where there is none, as with `pnpm dev`. */
async function loadLicenses(): Promise<License[] | null> {
  try {
    const response = await fetch('./licenses.json')
    if (!response.ok) return null
    const value: unknown = await response.json()
    return Array.isArray(value) ? value.filter(isLicense) : null
  } catch {
    return null
  }
}

function isLicense(value: unknown): value is License {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    typeof v.version === 'string' &&
    typeof v.license === 'string' &&
    typeof v.text === 'string' &&
    (v.homepage === null || (typeof v.homepage === 'string' && v.homepage.startsWith('https://')))
  )
}

function licenseItem(license: License): HTMLElement {
  return h(
    'li',
    {},
    h(
      'details',
      {},
      h('summary', {}, h('strong', {}, license.name), ` ${license.version} · ${license.license}`),
      license.homepage ? h('p', {}, link(license.homepage, license.homepage)) : null,
      h('pre', { class: 'license-text' }, license.text),
    ),
  )
}

function nativeList(): HTMLElement {
  return h(
    'ul',
    { class: 'license-list' },
    ...NATIVE.map((item) =>
      h('li', {}, h('strong', {}, item.name), ' · ', link(item.url, item.license)),
    ),
  )
}
