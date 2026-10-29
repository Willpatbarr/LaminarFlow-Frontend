/*
┌─ comments ──────────────────────────────────────
│  the server's length limit for a comment, and how this client counts against it
├─ out ───────────────────────────────────────────
│      COMMENT_MAX      50,000 characters (code points), as for a ticket description
│      commentCount     text → Count for a field
│      isBlank          true when nothing but whitespace is left
*/
// The number is the backend's (`maxLength` on CreateCommentInputBody in
// api/openapi.json); comments.test.tsx fails if it drifts. The server's 422
// stays the authority.
import type { Count } from '@/components/ui/count'

export const COMMENT_MAX = 50_000

/** The server counts code points, not UTF-16 units. */
export const commentCount = (text: string): Count => ({ used: [...text].length, max: COMMENT_MAX })

export const isBlank = (text: string): boolean => text.trim() === ''
