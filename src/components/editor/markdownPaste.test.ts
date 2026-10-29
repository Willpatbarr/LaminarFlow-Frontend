import { describe, expect, it } from 'vitest'

import { looksLikeMarkdown } from './markdownPaste'

describe('looksLikeMarkdown', () => {
    it.each(['# Title', 'intro\n\n## Sub', '- a\n- b', '1. one', '> quoted', '```\ncode\n```', 'some **bold** text', 'a [link](https://x.io)', 'use `code` here'])(
        'says yes to %j',
        (text) => expect(looksLikeMarkdown(text)).toBe(true),
    )

    it.each(['just a sentence.', 'Dear Ada, 2 - 1 = 1', 'a_b_c and 3*4', ''])('says no to %j', (text) =>
        expect(looksLikeMarkdown(text)).toBe(false),
    )
})
