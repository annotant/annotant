// The images a reader attaches to a message: files beside the comments file,
// `images/<comment id>/<message id>-<n>.<ext>`, never inline in the JSON.
// The server takes them from the widget, the agent opens them with Read.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// The limits, shared with the widget, which refuses an image before sending it.
import limits from './image-limits.json' with { type: 'json' }

/** The most images one message carries. */
export const MAX_IMAGES = limits.maxImages
/** The most bytes one image holds: what Claude reads in one image. */
export const MAX_IMAGE_BYTES = limits.maxImageBytes

/**
 * How the file of each type taken starts: the bytes decide, never the type
 * the widget claims.
 * @type {Record<string, (data: Buffer) => boolean>}
 */
const SIGNATURES = {
  'image/png': (data) =>
    data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': (data) => data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
  'image/gif': (data) => /^GIF8[79]a/.test(data.subarray(0, 6).toString('latin1')),
  'image/webp': (data) =>
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP',
}

/**
 * The types taken, each with its file's extension and how its file starts.
 * @type {Record<string, { ext: string, matches: (data: Buffer) => boolean }>}
 */
const TYPES = Object.fromEntries(
  Object.entries(limits.types).map(([type, ext]) => {
    const matches = SIGNATURES[type]
    if (!matches) throw new Error(`no signature for ${type}`)
    return [type, { ext, matches }]
  }),
)

/** By extension, the type an image's file is served with. */
export const CONTENT_TYPES = Object.fromEntries(
  Object.entries(TYPES).map(([type, { ext }]) => [ext, type]),
)

/** An image's file name, as the store writes it: `m1-1.png`. */
export const IMAGE_NAME = new RegExp(
  `^m\\d+-\\d+\\.(${Object.values(limits.types).join('|')})$`,
)

/**
 * An image the reader attached, checked: its bytes and its file's extension.
 * @typedef {{ data: Buffer, ext: string }} Image
 */

/** An image the server refused: its words, for the reader. */
export class ImageRefusal extends Error {}

/**
 * The images of a message as the widget sends them, `{ type, data }` with
 * `data` in base64, checked; an ImageRefusal saying why when one is not taken.
 * @param {unknown} input
 * @returns {Image[]}
 */
export function parseImages(input) {
  if (input === undefined) return []
  if (!Array.isArray(input)) throw new ImageRefusal('images must be a list')
  if (input.length > MAX_IMAGES) {
    throw new ImageRefusal(`at most ${MAX_IMAGES} images per message`)
  }
  return input.map((image) => {
    const known = TYPES[typeof image?.type === 'string' ? image.type : '']
    if (!known || typeof image.data !== 'string') {
      throw new ImageRefusal('only PNG, JPEG, GIF and WebP images are taken')
    }
    const data = Buffer.from(image.data, 'base64')
    if (data.length > MAX_IMAGE_BYTES) {
      throw new ImageRefusal(`an image may hold at most ${MAX_IMAGE_BYTES >> 20} MB`)
    }
    if (!known.matches(data)) throw new ImageRefusal(`not a ${image.type} image`)
    return { data, ext: known.ext }
  })
}

/**
 * The folder of comment `id`'s images, beside the comments file.
 * @param {{ commentsFile: string }} project
 * @param {string} id
 */
export const imagesDir = (project, id) =>
  path.join(path.dirname(project.commentsFile), 'images', id)

/**
 * Writes the images of message `message` of comment `id`.
 * @param {{ commentsFile: string }} project
 * @param {string} id
 * @param {string} message
 * @param {Image[]} images
 * @returns {Promise<string[]>} Their file names, in their order.
 */
export async function saveImages(project, id, message, images) {
  if (!images.length) return []
  const dir = imagesDir(project, id)
  await mkdir(dir, { recursive: true })
  return Promise.all(
    images.map(async ({ data, ext }, index) => {
      const name = `${message}-${index + 1}.${ext}`
      await writeFile(path.join(dir, name), data)
      return name
    }),
  )
}

/**
 * Removes comment `id`'s images: all of them, or those named.
 * @param {{ commentsFile: string }} project
 * @param {string} id
 * @param {string[]} [names]
 */
export async function removeImages(project, id, names) {
  const dir = imagesDir(project, id)
  if (!names) return rm(dir, { recursive: true, force: true })
  await Promise.all(names.map((name) => rm(path.join(dir, name), { force: true })))
}
