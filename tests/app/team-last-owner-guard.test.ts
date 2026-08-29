// tests/app/team-last-owner-guard.test.ts
//
// The "an org must always keep at least one owner" guard lives in the team
// settings server actions, not a DB trigger (see qa/FINDINGS.md and the
// comment in supabase/migrations/0013_team.sql for why: a trigger also fires
// for a cascaded delete, e.g. a whole account being deleted, which is a
// different situation than this UI deliberately demoting/removing a member).
// This is the only place that guarantee is actually enforced, so it needs
// its own direct test rather than relying on the DB-level tests to catch it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const eq = vi.fn()
const update = vi.fn(() => ({ eq }))
const del = vi.fn(() => ({ eq }))
const select = vi.fn()
const from = vi.fn((table: string) => (table === 'org_members' ? { update, delete: del, select } : {}))
const revalidatePath = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ from }) }))
vi.mock('@/lib/org/current', () => ({ getCurrentOrgId: async () => 'org-1' }))

beforeEach(() => {
  eq.mockReset().mockReturnValue({ eq, then: undefined })
  update.mockClear()
  del.mockClear()
  select.mockReset()
  from.mockClear()
})

// select().eq().eq() resolves to { data: owners }
function mockOwners(owners: Array<{ user_id: string }>) {
  select.mockReturnValue({ eq: () => ({ eq: async () => ({ data: owners }) }) })
}

describe('changeMemberRole', () => {
  it('refuses to demote the sole owner', async () => {
    mockOwners([{ user_id: 'user-1' }])
    const { changeMemberRole } = await import('@/app/(app)/settings/team/actions')
    const result = await changeMemberRole('user-1', 'member')
    expect(result).toEqual({ error: 'last_owner' })
    expect(update).not.toHaveBeenCalled()
  })

  it('allows demoting a member who is not the sole owner', async () => {
    mockOwners([{ user_id: 'user-1' }, { user_id: 'user-2' }])
    eq.mockReturnValue({ eq: async () => ({ error: null }) })
    const { changeMemberRole } = await import('@/app/(app)/settings/team/actions')
    const result = await changeMemberRole('user-1', 'member')
    expect(result).toEqual({ error: null })
    expect(update).toHaveBeenCalledWith({ role: 'member' })
  })

  it('allows granting owner to someone else regardless of current owner count', async () => {
    mockOwners([{ user_id: 'user-1' }])
    eq.mockReturnValue({ eq: async () => ({ error: null }) })
    const { changeMemberRole } = await import('@/app/(app)/settings/team/actions')
    const result = await changeMemberRole('user-2', 'owner')
    expect(result).toEqual({ error: null })
    expect(update).toHaveBeenCalledWith({ role: 'owner' })
  })
})

describe('removeMember', () => {
  it('refuses to remove the sole owner', async () => {
    mockOwners([{ user_id: 'user-1' }])
    const { removeMember } = await import('@/app/(app)/settings/team/actions')
    const result = await removeMember('user-1')
    expect(result).toEqual({ error: 'last_owner' })
    expect(del).not.toHaveBeenCalled()
  })

  it('allows removing a member who is not the sole owner', async () => {
    mockOwners([{ user_id: 'user-1' }, { user_id: 'user-2' }])
    eq.mockReturnValue({ eq: async () => ({ error: null }) })
    const { removeMember } = await import('@/app/(app)/settings/team/actions')
    const result = await removeMember('user-2')
    expect(result).toEqual({ error: null })
    expect(del).toHaveBeenCalled()
  })
})
