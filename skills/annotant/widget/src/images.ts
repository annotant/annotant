import type { NewImage } from './domain'

// The server's limits, scripts/lib/images.mjs's, from the same file.
import limits from '../../scripts/lib/image-limits.json' with { type: 'json' }

const TYPES = new Set(Object.keys(limits.types))
const MAX_IMAGE_BYTES = limits.maxImageBytes
/** The most bytes a message's images hold together. */
const MAX_MESSAGE_BYTES = limits.maxMessageBytes
/** The most images one message carries, far more than a reader attaches: the server's bound. */
const MAX_IMAGES = limits.maxImages

/** The bytes of an image read to be sent, from its base64. */
export const imageBytes = (image: NewImage) => Math.floor((image.data.length * 3) / 4)

/** Whether `images` stay within what one message may hold. */
export const fits = (images: NewImage[]) =>
  images.reduce((sum, image) => sum + imageBytes(image), 0) <= MAX_MESSAGE_BYTES

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
 * Of `files`, those the images attached already leave room for (`bytes` of
 * them, `count` in all, those still being read included: a second paste
 * before the first is read counts it): the ones the server takes, up to
 * MAX_MESSAGE_BYTES and MAX_IMAGES in all, and why the others are left out.
 */
export function pick(
  bytes: number,
  files: File[],
  count = 0,
): { files: File[]; refused?: string } {
  const taken = files.filter((file) => TYPES.has(file.type))
  const small = taken.filter((file) => file.size <= MAX_IMAGE_BYTES)
  let total = bytes
  const fitting = small.filter((file) => {
    if (total + file.size > MAX_MESSAGE_BYTES) return false
    total += file.size
    return true
  })
  const room = fitting.slice(0, Math.max(0, MAX_IMAGES - count))
  const refused =
    taken.length < files.length
      ? `Only ${limits.named} images can be attached.`
      : small.length < taken.length
        ? `An image may hold at most ${MAX_IMAGE_BYTES >> 20} MB.`
        : fitting.length < small.length
          ? `The images of a message may hold at most ${MAX_MESSAGE_BYTES >> 20} MB together.`
          : room.length < fitting.length
            ? `At most ${MAX_IMAGES} images per message.`
            : undefined
  return refused ? { files: room, refused } : { files: room }
}

/** The images in `files`, read to be sent. */
export const readImages = (files: File[]) => Promise.all(files.map(read))
