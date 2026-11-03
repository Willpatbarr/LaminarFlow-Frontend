import { Input } from '@/components/ui/Input'

import { formatDay } from './kinds'

// A native date input (the editing control, which shows the browser's own
// format) with the day written the way the lists write it, "2 Nov 2026", beside it.
export function DateField(props: {
    label: string
    value: string
    onInput: (value: string) => void
    onBlur?: () => void
    readOnly?: boolean
    error?: string
}) {
    return (
        <div class="hierarchy__date">
            <Input
                label={props.label}
                type="date"
                value={props.value}
                onInput={props.onInput}
                onBlur={props.onBlur}
                readOnly={props.readOnly}
                error={props.error}
            />
            <span class="t-meta hierarchy__date-text" data-testid={`${props.label} text`}>
                {formatDay(props.value)}
            </span>
        </div>
    )
}
