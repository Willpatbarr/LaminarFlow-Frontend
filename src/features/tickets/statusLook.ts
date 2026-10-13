import type { Hue } from '@/components/ui/StatusPill'
import type { Status } from '@/sync'

/*
┌─ tickets ───────────────────────────────────────
│  how a status row from the server is drawn as a pill
├─ out ───────────────────────────────────────────
│      hueFor       a stored colour → the nearest of the sheet's eight hues
│      isStarted    filled dot or ring
├─ example ───────────────────────────────────────
│      "#3b82f6"  →  'blue'        "#94a3b8"  →  'slate'
*/
// A status carries whatever hex its team picked. The design system has eight
// hues and a rule that nothing a user creates is drawn more saturated than the
// accent, so the stored colour chooses a hue and is never painted itself.

// Where each hue sits on the colour wheel, in degrees.
const WHEEL: [Hue, number][] = [
    ['rust', 3],
    ['clay', 23],
    ['amber', 41],
    ['green', 142],
    ['teal', 186],
    ['blue', 210],
    ['violet', 265],
    ['rust', 363],
]

// Below this, a colour reads as grey whatever its hue angle says. The seeded
// "To Do" (#94a3b8, a blue-grey at 0.20) has to land on slate.
const GREY_BELOW = 0.25

export function hueFor(color: string): Hue {
    const match = /^#?([0-9a-f]{6})$/i.exec(color.trim())
    if (!match) return 'slate'
    const value = parseInt(match[1], 16)
    const r = ((value >> 16) & 255) / 255
    const g = ((value >> 8) & 255) / 255
    const b = (value & 255) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const spread = max - min
    const lightness = (max + min) / 2
    const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * lightness - 1))
    if (saturation < GREY_BELOW) return 'slate'

    let angle: number
    if (max === r) angle = ((g - b) / spread) % 6
    else if (max === g) angle = (b - r) / spread + 2
    else angle = (r - g) / spread + 4
    angle = (angle * 60 + 360) % 360

    let nearest = WHEEL[0]
    for (const candidate of WHEEL) {
        if (Math.abs(candidate[1] - angle) < Math.abs(nearest[1] - angle)) nearest = candidate
    }
    return nearest[0]
}

/** A filled dot means the work is in this status; a ring, that it has not begun. */
export function isStarted(status: Status): boolean {
    return status.category !== 'not_started'
}
