import { afterEach, describe, expect, it } from 'vitest'

import { eventually, localTicket, outbox, startClient, type Rig } from './support/rig'
import { fields, newAccount, newWorld, serverCreate, serverTicket } from './support/stack'

// A session that ends while the app is open. There is no API to expire one, so
// the test logs the session out from the side, which is what the server does to
// it when it expires: the next request with that cookie is a 401.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

describe('an expired session', () => {
  it('parks the edit as unauthorized, pauses the engine, and resumes after signing in again', async () => {
    const me = await newAccount('me')
    const world = await newWorld(me)
    const ticket = await serverCreate(me, world.projectId, fields('Before', { status_id: world.statusIds[0] }))
    const rig = await startClient(me)
    rigs.push(rig)
    await eventually('the socket is live', () => rig.connection() === 'live' || undefined)
    expect(await localTicket(rig, ticket.id)).toBeDefined()

    await me.logout()
    await rig.engine.updateTicket(ticket.id, { title: 'Written after the session ended' })
    await eventually('the entry is parked', async () => (await outbox(rig))[0]?.state === 'unauthorized' || undefined)

    const [entry] = await outbox(rig)
    expect(entry).toMatchObject({ state: 'unauthorized', error: { status: 401 } })
    expect(rig.engine.status().paused).toBe(true)
    // Nothing is lost: the edit is on screen, and the server has not seen it.
    expect((await localTicket(rig, ticket.id))?.title).toBe('Written after the session ended')
    const before = rig.requests.length
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(rig.requests.length).toBe(before)
    // The socket is held too: reconnecting would be refused until sign-in.
    expect(rig.connection()).toBe('offline')

    await me.login()
    await rig.engine.resume()
    await rig.engine.idle()

    expect(rig.engine.status().paused).toBe(false)
    expect(await outbox(rig)).toEqual([])
    expect(await serverTicket(me, ticket.id)).toMatchObject({ title: 'Written after the session ended', version: 2 })
    expect(await localTicket(rig, ticket.id)).toMatchObject({ title: 'Written after the session ended', version: 2 })
    await eventually('the socket is back', () => rig.connection() === 'live' || undefined)
  })

  it('also pauses on a failed hydration and picks up after a sign-in', async () => {
    const me = await newAccount('me')
    const world = await newWorld(me)
    const ticket = await serverCreate(me, world.projectId, fields('On the server'))
    await me.logout()

    const rig = await startClient(me, { socket: false })
    rigs.push(rig)
    expect(rig.engine.status()).toMatchObject({ paused: true, hydrated: false })
    expect(await localTicket(rig, ticket.id)).toBeUndefined()

    await me.login()
    await rig.engine.resume()
    await rig.engine.idle()
    expect(rig.engine.status()).toMatchObject({ paused: false, hydrated: true })
    expect(await localTicket(rig, ticket.id)).toMatchObject({ title: 'On the server' })
  })
})
