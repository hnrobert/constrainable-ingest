/** Password / token hashing via Bun's built-in argon2id. */
export const hashPassword = (plain: string): Promise<string> =>
  Bun.password.hash(plain, { algorithm: 'argon2id' })

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  Bun.password.verify(plain, hash)
