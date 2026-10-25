import argon2 from 'argon2';

// OWASP-recommended argon2id baseline (19 MiB, t=2, p=1).
const OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

// Verified against when the email is unknown so response timing doesn't
// reveal which accounts exist.
let dummyHash: Promise<string> | undefined;

export const passwordService = {
  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  },

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  },

  async burnTime(password: string): Promise<void> {
    dummyHash ??= argon2.hash('timing-equaliser-not-a-real-password', OPTIONS);
    await argon2.verify(await dummyHash, password).catch(() => false);
  },
};
