// What the editor should say on arrival after an import (LAM-119). The list
// navigates to the new type and the editor is a different screen, so the message
// travels here. The editor takes it once; it is not kept across a reload. Plain
// state, not a signal: it is read once when the editor is made.
let pending: string | null = null

export const leaveImportNotice = (message: string) => {
    pending = message
}

export const takeImportNotice = () => {
    const message = pending
    pending = null
    return message
}
