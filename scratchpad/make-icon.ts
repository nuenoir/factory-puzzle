/**
 * Generate the app icons, with no image library.
 *
 * A standalone Android build refuses to proceed without an icon, and there was
 * no assets directory at all. Rather than add an image dependency for one flat
 * shape, this writes the PNGs directly: Node ships `zlib`, and a PNG is a
 * signature, an IHDR, a deflated block of scanlines and an IEND.
 *
 * The mark is the game's own hexagon in the game's own green, because the board
 * is a hex grid and a puzzle icon should say what the puzzle is. Flat colour and
 * one shape, which is what survives being shown at 48 pixels.
 *
 * These are honest placeholders. They are legitimate for a closed test; the
 * public listing deserves a real design pass (see docs/store-listing.md).
 *
 *   node --experimental-strip-types scratchpad/make-icon.ts
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

/* ---- PNG ---------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA, 8 bits per channel, no interlacing. */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour with alpha
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none", which
  // deflate handles perfectly well on artwork this flat.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ])
}

/* ---- the mark ----------------------------------------------------------- */

interface Rgb { r: number; g: number; b: number }
const hex = (s: string): Rgb => ({
  r: parseInt(s.slice(1, 3), 16),
  g: parseInt(s.slice(3, 5), 16),
  b: parseInt(s.slice(5, 7), 16),
})

// Straight from app/theme.ts, so the icon and the board agree.
const GROUND = hex('#12141a')
const GREEN = hex('#4ade80')

/** Vertices of a pointy-top hexagon: a vertex straight up, as on the board. */
function hexagon(cx: number, cy: number, radius: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((-90 + 60 * i) * Math.PI) / 180
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as [number, number]
  })
}

/** Convex polygons let us test half-planes, which is cheaper than ray casting. */
function inside(poly: [number, number][], x: number, y: number): boolean {
  for (let i = 0; i < poly.length; i += 1) {
    const [ax, ay] = poly[i]
    const [bx, by] = poly[(i + 1) % poly.length]
    // Vertices run clockwise in screen coordinates (y grows downward), which
    // makes the cross product *positive* for interior points — checked against
    // the centre of the hexagon, because getting this backwards renders a
    // perfectly valid PNG of absolutely nothing.
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false
  }
  return true
}

/**
 * Draw the mark: a hexagonal ring, optionally on the game's dark ground.
 *
 * Supersampled 3×3. Without it the diagonals of a hexagon look chewed, and this
 * shape is nothing *but* diagonals.
 */
function render(size: number, opts: { ground: boolean; scale: number }): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  const centre = size / 2
  const outer = hexagon(centre, centre, size * 0.5 * opts.scale)
  const inner = hexagon(centre, centre, size * 0.5 * opts.scale * 0.62)
  const samples = 3
  const step = 1 / (samples + 1)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0
      for (let sy = 1; sy <= samples; sy += 1) {
        for (let sx = 1; sx <= samples; sx += 1) {
          const px = x + sx * step
          const py = y + sy * step
          if (inside(outer, px, py) && !inside(inner, px, py)) hits += 1
        }
      }
      const coverage = hits / (samples * samples)
      const i = (y * size + x) * 4

      if (opts.ground) {
        // Composite the ring over the board's own background colour.
        out[i] = Math.round(GROUND.r + (GREEN.r - GROUND.r) * coverage)
        out[i + 1] = Math.round(GROUND.g + (GREEN.g - GROUND.g) * coverage)
        out[i + 2] = Math.round(GROUND.b + (GREEN.b - GROUND.b) * coverage)
        out[i + 3] = 255
      } else {
        // Adaptive foreground: the mark alone, on transparency.
        out[i] = GREEN.r
        out[i + 1] = GREEN.g
        out[i + 2] = GREEN.b
        out[i + 3] = Math.round(coverage * 255)
      }
    }
  }
  return out
}

/* ---- write -------------------------------------------------------------- */

const ROOT = 'C:/Users/Bagus/OneDrive/Desktop/factory-puzzle'
const ASSETS = `${ROOT}/app/assets`
mkdirSync(ASSETS, { recursive: true })

const targets = [
  // The listing icon and Expo's `icon`. Fully opaque: Play rejects alpha here.
  { file: 'icon.png', size: 1024, ground: true, scale: 0.74 },
  // Adaptive foreground. Android masks this to roughly the central 66%, so the
  // mark is drawn smaller to survive a circular or squircle crop.
  { file: 'adaptive-icon.png', size: 1024, ground: false, scale: 0.56 },
  // No splash asset: wiring one needs `expo-splash-screen`, and an untested
  // plugin config is not worth a loading screen.
]

for (const target of targets) {
  const pixels = render(target.size, { ground: target.ground, scale: target.scale })
  const png = encodePng(target.size, target.size, pixels)
  writeFileSync(`${ASSETS}/${target.file}`, png)
  console.log(`${target.file.padEnd(20)} ${target.size}×${target.size}  ${(png.length / 1024).toFixed(1)} KB`)
}
