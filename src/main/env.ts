import { app } from 'electron'

export const is = {
  get dev(): boolean {
    return !app.isPackaged
  },
}

/** LAVANOTES_USER_DATA isolates test runs from the real notes. */
export function applyUserDataOverride(): void {
  const override = process.env.LAVANOTES_USER_DATA
  if (override) app.setPath('userData', override)
}
