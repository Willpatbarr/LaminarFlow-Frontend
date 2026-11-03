import { createContext, useContext } from 'solid-js'

// The shell's sign-out flow (it asks first when changes are unsynced), handed
// down so the Settings page's Log out uses the same one as the rail (LAM-200).
export const LeaveContext = createContext<() => void>(() => {})

export const useLeave = () => useContext(LeaveContext)
