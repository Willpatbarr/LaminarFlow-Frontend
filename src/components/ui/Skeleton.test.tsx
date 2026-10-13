import { render } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { SkeletonBox, SkeletonCircle, SkeletonLine } from './Skeleton'

describe('skeleton primitives', () => {
    it('are all hidden from assistive technology: the container announces the loading', () => {
        const { container } = render(() => (
            <>
                <SkeletonLine />
                <SkeletonBox height="40px" />
                <SkeletonCircle size="20px" />
            </>
        ))

        const shapes = Array.from(container.querySelectorAll('.skeleton'))
        expect(shapes).toHaveLength(3)
        for (const shape of shapes) {
            expect(shape).toHaveAttribute('aria-hidden', 'true')
            expect(shape.textContent).toBe('')
        }
    })

    it('size themselves from CSS lengths, never bare numbers', () => {
        const { container } = render(() => (
            <>
                <SkeletonLine width="60%" height="12px" />
                <SkeletonBox width="9ch" height="2rem" shape="pill" />
                <SkeletonCircle size="26px" />
            </>
        ))
        const [line, box, circle] = Array.from(container.querySelectorAll<HTMLElement>('.skeleton'))

        expect(line.style.width).toBe('60%')
        expect(line.style.height).toBe('12px')
        expect(box.style.width).toBe('9ch')
        expect(box.style.height).toBe('2rem')
        expect(circle.style.width).toBe('26px')
        expect(circle.style.height).toBe('26px')
    })

    it('default to the width of their container, and pick a radius from the shape', () => {
        const { container } = render(() => (
            <>
                <SkeletonLine />
                <SkeletonBox height="40px" />
                <SkeletonBox height="21px" shape="pill" />
                <SkeletonBox height="64px" shape="card" />
                <SkeletonCircle size="20px" />
            </>
        ))
        const shapes = Array.from(container.querySelectorAll<HTMLElement>('.skeleton'))

        expect(shapes[0].style.width).toBe('100%')
        expect(shapes[1].style.width).toBe('100%')
        expect(shapes.map((shape) => shape.className.replace('skeleton ', ''))).toEqual([
            'skeleton--line',
            'skeleton--control',
            'skeleton--pill',
            'skeleton--card',
            'skeleton--circle',
        ])
    })

    it('would not compile with a bare number for a size', () => {
        // @ts-expect-error a number does not say whether it is px, ch or a share
        render(() => <SkeletonLine width={220} />)
    })
})
