// Who is looking, as much as the ticket screens need to know. Passed in by the
// route rather than read from the auth feature, because a feature does not
// import another feature (src/features/README.md).
export type Viewer = {
    accountId: string
    workspaceId: string
    displayName: string
}
