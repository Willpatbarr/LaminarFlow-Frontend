import type { EntityName } from '../types'
import { boardEntity } from './board'
import { documentEntity } from './document'
import { epicEntity, labelEntity, milestoneEntity, sprintEntity } from './hierarchy'
import type { Entity, LooseRules } from './entity'
import { statusEntity } from './status'
import { ticketEntity } from './ticket'

/*
┌─ sync/entities ─────────────────────────────────
│  the registry: every entity the sync engine carries
├─ out ───────────────────────────────────────────
│      ENTITIES, entityFor(name), entityForEvent(frame type)
*/
// Order is hydration order and nothing else.
export const ENTITIES: readonly Entity[] = [
    ticketEntity,
    documentEntity,
    statusEntity,
    boardEntity,
    epicEntity,
    sprintEntity,
    milestoneEntity,
    labelEntity,
] as unknown as readonly Entity[]

/** The registered entity called `name`. */
export function entityFor<N extends EntityName>(name: N): Entity<N> {
    const found = ENTITIES.find((entity) => entity.name === name)
    if (!found) throw new Error(`no sync entity called ${name}`)
    return found as unknown as Entity<N>
}

/** The rules of the entity called `name`, row types erased: for the engine,
 *  which treats every entity alike. */
export function rulesFor(name: EntityName): LooseRules {
    return entityFor(name).rules as unknown as LooseRules
}
