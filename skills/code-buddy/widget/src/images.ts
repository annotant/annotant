import type { NewImage } from './domain'

// The server's limits, scripts/lib/images.mjs's, from the same file.
import limits from '../../scripts/lib/image-limits.json' with { type: 'json' }

const TYPES = new Set(Object.keys(limits.types))
/** The most images one message carries. */
export const MAX_IMAGES = limits.maxImages
const MAX_IMAGE_BYTES = limits.maxImageBytes

/** The image files among `files`: what a paste or a drop brings. */
export const imageFiles = (files: Iterable<File>) =>
  [...files].filter((file) => file.type.startsWith('image/'))

/** An image as the thumbnail shows it before it is sent. */
export const preview = (image: NewImage) => `data:${image.type};base64,${image.data}`

function read(file: File): Promise<NewImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      resolve({ type: file.type, data: url.slice(url.indexOf(',') + 1) })
    })
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('unreadable')),
    )
    reader.readAsDataURL(file)
  })
}

/**
 * Of `files`, those `count` images attached already leave room for: the
 * ones the server takes, up to MAX_IMAGES in all, and why the others are
 * left out. At once: a second paste counts the first's.
 */
export function pick(count: number, files: File[]): { files: File[]; refused?: string } {
  const taken = files.filter((file) => TYPES.has(file.type))
  const small = taken.filter((file) => file.size <= MAX_IMAGE_BYTES)
  const room = small.slice(0, Math.max(0, MAX_IMAGES - count))
  const refused =
    taken.length < files.length
      ? `Only ${limits.named} images can be attached.`
      : small.length < taken.length
        ? `An image may hold at most ${MAX_IMAGE_BYTES >> 20} MB.`
        : room.length < small.length
          ? `At most ${MAX_IMAGES} images per message.`
          : undefined
  return refused ? { files: room, refused } : { files: room }
}

/** The images in `files`, read to be sent. */
export const readImages = (files: File[]) => Promise.all(files.map(read))
