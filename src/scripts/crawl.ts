type Style = 'cjs' | 'dual' | 'esm' | 'faux'

import fs from 'node:fs/promises'
import process from 'node:process'
import dotenv from 'dotenv'
import pacote, { type Packument, type PackumentResult } from 'pacote'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({ options: { debug: { short: 'd', type: 'boolean', default: false } } })

dotenv.config()

const token = process.env.NPM_TOKEN


async function main() {

  let npmHighImpact: string[]

  if (args.debug) {
    npmHighImpact = [
      'execa',
      'chalk'
    ]
  } else {
    const { npmHighImpact: impacted } = await import('npm-high-impact')
    npmHighImpact = impacted
  }


  // if (!token) {
  //   throw new Error(
  //     'Expected `NPM_TOKEN` in env, please add a `.env` file with it'
  //   )
  // }

  let slice = 0
  const size = 20
  const now = new Date()
  const relativeFile =
    String(now.getUTCFullYear()).padStart(4, '0') +
    '-' +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getUTCDate()).padStart(2, '0')
  const filename = `data/${relativeFile}.json`


  try {
    await fs.statfs(filename)
    if (process.env.UNSAFE_OVERWRITE_FILE === 'true') {
      await fs.rm(filename, { force: true })
      await fs.statfs(filename)
    } else {
      throw new Error(`File already exists: ${filename}`)
    }
  } catch (err) {
    if (err.code == 'ENOENT') {
      await fs.writeFile(filename, '')
    } else {
      throw err
    }
  }


  const destination = await fs.open(filename, 'w+')

  // const destination = new URL(relativeFile, `file://${process.cwd()}`)

  const allResults: Record<string, Style> = {}

  console.log('fetching %s packages', npmHighImpact.length)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const names = npmHighImpact.slice(slice * size, (slice + 1) * size)

    if (names.length === 0) {
      break
    }

    console.log(
      'fetching page: %s, collected total: %s out of %s',
      slice,
      slice * size,
      npmHighImpact.length
    )

    const promises = names.map(async function (name) {
      const result = await pacote.packument(name, {
        fullMetadata: true,
        preferOffline: true,
        token
      })


      const info: [string, any] = [name, analyzePackument(result)]
      return info
    })


    let results: any

    try {
      results = await Promise.all(promises)
    } catch (error) {
      console.log(error)
      console.log('sleeping for 10s…')
      await sleep(10 * 1000)
      continue
    }

    for (const [name, style] of results) {
      allResults[name] = style
      console.log('  add: %s ', name)
    }

    // Intermediate writes to help debugging and seeing some results early.
    // setTimeout(async function () {
    //   await fs.writeFile(
    //     destination,
    //     JSON.stringify(allResults, undefined, 2) + '\n'
    //   )
    // })

    slice++
  }

  await fs.writeFile(destination, JSON.stringify(allResults, undefined, 2) + '\n')
  console.log('done!', allResults)



  /**
   * @param {number} ms
   *   Miliseconds to sleep.
   * @returns {Promise<undefined>}
   *   Nothing.
   */
  function sleep(ms: number) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(undefined)
      }, ms)
    })
  }

  /**
   * @param {Packument & PackumentResult} result
   *   Result.
   * @returns {Style}
   *   Style.
   */
  function analyzePackument(result: Packument) {
    return Object.fromEntries(
      Object.entries(result.versions)
        .map(([version, packument]) => {


          const { exports, main, type } = packument
          /** @type {boolean | undefined} */
          let cjs
          /** @type {boolean | undefined} */
          let esm
          /** @type {boolean | undefined} */
          let fauxEsm

          if (packument.module) {
            fauxEsm = true
          }

          // Check exports map.
          if (exports && typeof exports === 'object') {
            for (const exportId in exports) {
              if (Object.hasOwn(exports, exportId) && typeof exportId === 'string') {
                let value: any = (exports[exportId])

                if (exportId.charAt(0) !== '.') {
                  value = { '.': value }
                }

                analyzeThing(value, packument.name + '#exports')
              }
            }
          }

          // Explicit `commonjs` set, with a explicit `import ` or `.mjs` too.
          if (esm && type === 'commonjs') {
            cjs = true
          }

          // Explicit `module` set, with explicit `require` or `.cjs` too.
          if (cjs && type === 'module') {
            esm = true
          }

          // If there are no explicit exports:
          if (cjs === undefined && esm === undefined) {
            if (type === 'module' || (main && /\.mjs$/.test(main))) {
              esm = true
            } else {
              cjs = true
            }
          }


          const style = esm && cjs ? 'dual' : esm ? 'esm' : fauxEsm ? 'faux' : 'cjs'

          // console.log(packument)
          return [version, { style, time: result.time[version] }]


          /**
           * @param {unknown} value
           *   Thing.
           * @param {string} path
           *   Path in `package.json`.
           * @returns {undefined}
           *   Nothing.
           */
          function analyzeThing(value: any, path: string) {
            if (value && typeof value === 'object') {
              if (Array.isArray(value)) {
                const values: string[] = value
                let index = -1
                while (++index < values.length) {
                  analyzeThing(values[index], path + '[' + index + ']')
                }
              } else {
                let explicit = false
                if ('import' in value && value.import) {
                  explicit = true
                  esm = true
                }

                if ('require' in value && value.require) {
                  explicit = true
                  cjs = true
                }

                const defaults = (
                  value.node || value.default
                )

                if (typeof defaults === 'string' && !explicit) {
                  if (/\.mjs$/.test(defaults)) esm = true
                  if (/\.cjs$/.test(defaults)) cjs = true
                }
              }
            } else if (typeof value === 'string') {
              if (/\.mjs$/.test(value)) esm = true
              if (/\.cjs$/.test(value)) cjs = true
            } else {
              console.log('unknown:', [value], path)
            }
          }
        })
    );
  }
}


main()
  .then(() => console.log('main done'))
// .catch(err => console.warn('main rejected', err))