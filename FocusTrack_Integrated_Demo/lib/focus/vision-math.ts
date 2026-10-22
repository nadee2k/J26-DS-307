// Geometry for Component 3: head pose from 3D face landmarks, eye-relative iris position and image quality.
// Replaces the earlier prototype, which used the nose position in the frame as "pitch" (that measured where
// the face was in the image, not where the head was turned) and the iris position in the frame as "gaze".

export type LM = { x: number; y: number; z: number }
type V = { x: number; y: number; z: number }

const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const norm = (a: V): V => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l } }
const deg = (r: number) => (r * 180) / Math.PI

// MediaPipe Face Mesh indices
const IDX = {
  rightEyeOuter: 33, rightEyeInner: 133, rightEyeUpper: 159, rightEyeLower: 145,
  leftEyeOuter: 263, leftEyeInner: 362, leftEyeUpper: 386, leftEyeLower: 374,
  forehead: 10, chin: 152, faceLeft: 234, faceRight: 454,
  irisA: 468, irisB: 473,
}

/**
 * Head rotation from the 3D landmark frame (eye-to-eye axis and forehead-to-chin axis).
 * Image coordinates are converted to an isotropic space (x·W, y·H, z·W); MediaPipe's z grows away from the camera.
 * Returns degrees: pitch > 0 = looking down, yaw = turning left/right, roll = tilt. Independent of where the face is in the frame.
 */
export function headPose(lm: LM[], w: number, h: number) {
  const p = (i: number): V => ({ x: lm[i].x * w, y: lm[i].y * h, z: lm[i].z * w })
  const xAxis = norm(sub(p(IDX.leftEyeOuter), p(IDX.rightEyeOuter))) // towards image right
  const yDown = norm(sub(p(IDX.chin), p(IDX.forehead))) // forehead → chin
  const zAway = norm(cross(xAxis, yDown)) // into the scene
  const n = { x: -zAway.x, y: -zAway.y, z: -zAway.z } // face normal, pointing at the camera when facing it
  return {
    yaw: deg(Math.atan2(n.x, -n.z)),
    pitch: deg(Math.atan2(n.y, -n.z)),
    roll: deg(Math.atan2(xAxis.y, xAxis.x)),
  }
}

/** Iris position relative to each eye's corners (−1 … 1), averaged over both eyes. Image-right and down are positive. */
export function irisOffset(lm: LM[], w: number, h: number) {
  if (lm.length <= IDX.irisB) return null
  const P = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h })
  const eyes = [
    { outer: P(IDX.rightEyeOuter), inner: P(IDX.rightEyeInner), up: P(IDX.rightEyeUpper), low: P(IDX.rightEyeLower) },
    { outer: P(IDX.leftEyeOuter), inner: P(IDX.leftEyeInner), up: P(IDX.leftEyeUpper), low: P(IDX.leftEyeLower) },
  ]
  const irises = [P(IDX.irisA), P(IDX.irisB)]
  let sx = 0, sy = 0, n = 0
  for (const e of eyes) {
    const cx = (e.outer.x + e.inner.x) / 2, cy = (e.outer.y + e.inner.y) / 2
    const half = Math.abs(e.inner.x - e.outer.x) / 2
    if (half < 1) continue
    // pair each eye with the nearer iris centre (robust to MediaPipe's left/right naming)
    const iris = irises.reduce((a, b) => (Math.hypot(a.x - cx, a.y - cy) <= Math.hypot(b.x - cx, b.y - cy) ? a : b))
    sx += (iris.x - cx) / half
    sy += (iris.y - (e.up.y + e.low.y) / 2) / half
    n++
  }
  return n ? { x: sx / n, y: sy / n } : null
}

export function faceWidth(lm: LM[]) {
  return Math.abs(lm[IDX.faceRight].x - lm[IDX.faceLeft].x)
}

/** Eye-region bounding boxes in normalised coordinates, for the glare check. */
export function eyeBoxes(lm: LM[]) {
  const box = (ids: number[]) => {
    const xs = ids.map((i) => lm[i].x), ys = ids.map((i) => lm[i].y)
    const pad = 0.012
    return { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad }
  }
  return [
    box([IDX.rightEyeOuter, IDX.rightEyeInner, IDX.rightEyeUpper, IDX.rightEyeLower]),
    box([IDX.leftEyeOuter, IDX.leftEyeInner, IDX.leftEyeUpper, IDX.leftEyeLower]),
  ]
}

/** Mean luminance of a frame and the share of near-saturated pixels inside the eye boxes (specular glare on glasses). */
export function imageQuality(img: ImageData, boxes: { x0: number; x1: number; y0: number; y1: number }[]) {
  const { data, width, height } = img
  let sum = 0, n = 0
  for (let i = 0; i < data.length; i += 16) { sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++ }
  let bright = 0, total = 0
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x0 * width)), x1 = Math.min(width - 1, Math.ceil(b.x1 * width))
    const y0 = Math.max(0, Math.floor(b.y0 * height)), y1 = Math.min(height - 1, Math.ceil(b.y1 * height))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = (y * width + x) * 4
      const lum = 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]
      if (lum > 235) bright++
      total++
    }
  }
  return { luminance: n ? sum / n : 0, glare: total ? bright / total : 0 }
}

/** Fixed-angle rule used as the C3 baseline: one threshold for everybody, no desk zone personalisation. */
export function fixedZone(pitch: number, yaw: number): 0 | 1 | 2 {
  if (Math.abs(yaw) > 25 || pitch < -15) return 2
  if (pitch > 20) return 1
  return 0
}
