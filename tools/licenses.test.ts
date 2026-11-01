import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectLicenses, packageFolder } from './licenses'

describe('packageFolder', () => {
  it('finds the package below the last node_modules, scoped or not', () => {
    expect(packageFolder('/x/node_modules/.pnpm/uqr@0.1.3/node_modules/uqr/dist/index.mjs')).toBe(
      '/x/node_modules/.pnpm/uqr@0.1.3/node_modules/uqr',
    )
    expect(packageFolder('/x/node_modules/@capacitor/core/dist/index.js?v=1')).toBe(
      '/x/node_modules/@capacitor/core',
    )
    expect(packageFolder('C:\\x\\node_modules\\jsqr\\dist\\jsQR.js')).toBe('C:/x/node_modules/jsqr')
  })

  it('leaves out the game’s own code and Vite’s virtual modules', () => {
    expect(packageFolder('/x/src/main.ts')).toBeNull()
    expect(packageFolder('/x/packages/p2p/src/index.ts')).toBeNull()
    expect(packageFolder('\0vite/preload-helper.js')).toBeNull()
    expect(packageFolder('/x/node_modules/.pnpm/lock.yaml')).toBeNull()
  })
})

describe('collectLicenses', () => {
  it('reads each package once, with its license text', () => {
    const uqr = resolve('node_modules/.pnpm/node_modules/uqr/dist/index.mjs')
    const list = collectLicenses([uqr, uqr, resolve('src/main.ts')])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'uqr', license: 'MIT' })
    expect(list[0]?.text).toMatch(/Permission is hereby granted/)
  })
})
