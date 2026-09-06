import { api } from './client'

/*
┌─ api ───────────────────────────────────────────
│  fetches the ping endpoint through the contract
├─ out ───────────────────────────────────────────
│      PingBody    message, time, $schema
├─ example ───────────────────────────────────────
│      GET /api/v1/ping  →  { message: "pong" }
*/
export async function getPing() {
    const { data, error } = await api.GET('/api/v1/ping')
    if (error) {
        throw new Error('ping failed')
    }
    return data
}