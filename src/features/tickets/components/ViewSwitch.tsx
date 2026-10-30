import { SegmentedNav } from '@/components/ui/Segmented'
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint'
import { toSearch, type FilterGroup } from '../listView/config'
import { boardSearch } from '../savedViews/savedView'
import './tickets.css'

// List | Board, in the header of both screens (LAM-181). Links, not radios: it
// goes to another page, and the current one says so with aria-current. The
// filter rides along in the URL, as it does everywhere else; the rest of the
// list's config (sort, group) is the list's own and is not carried to the board.
// The key for the other view sits beside it (hidden on touch).
export function ViewSwitch(props: { current: 'list' | 'board'; projectId: string; boardId: string; filter?: FilterGroup }) {
    const list = () => {
        const search = toSearch({ filter: props.filter }).toString()
        return `/projects/${encodeURIComponent(props.projectId)}${search ? `?${search}` : ''}`
    }
    const board = () => {
        const search = boardSearch(props.filter).toString()
        return `/boards/${encodeURIComponent(props.boardId)}${search ? `?${search}` : ''}`
    }
    return (
        <div class="view-switch">
            <SegmentedNav
                label="View"
                current={props.current}
                items={[
                    { value: 'list', label: 'List', href: list() },
                    { value: 'board', label: 'Board', href: board() },
                ]}
            />
            <ShortcutHint id={props.current === 'list' ? 'nav.board' : 'nav.tickets'} />
        </div>
    )
}
