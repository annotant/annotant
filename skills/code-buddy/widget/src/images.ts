import type { NewImage } from './domain'

/** The types the server takes, as scripts/lib/images.mjs checks them. */
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
/** As the server: the most images one message carries, and bytes one image holds. */
export const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

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
 * The images `files` add to `count` attached already: those the server
 * takes, up to MAX_IMAGES in all, and why the others are left out.
 */
export async function attach(
  count: number,
  files: File[],
): Promise<{ images: NewImage[]; refused?: string }> {
  const taken = files.filter((file) => TYPES.has(file.type))
  const small = taken.filter((file) => file.size <= MAX_IMAGE_BYTES)
  const room = small.slice(0, Math.max(0, MAX_IMAGES - count))
  const refused =
    taken.length < files.length
      ? 'Only PNG, JPEG, GIF and WebP images can be attached.'
      : small.length < taken.length
        ? `An image may hold at most ${MAX_IMAGE_BYTES >> 20} MB.`
        : room.length < small.length
          ? `At most ${MAX_IMAGES} images per message.`
          : undefined
  const images = await Promise.all(room.map(read))
  return refused ? { images, refused } : { images }
}
