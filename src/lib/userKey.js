export const userKey = (user, key) => (user?.id ? `n2:${user.id}:${key}` : `n2:anon:${key}`)
