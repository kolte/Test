import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('round-trips: a hash verifies against the password it was created from', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('incorrect horse', hash)).resolves.toBe(false);
  });

  it('produces a different hash (different salt) for the same password each time', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toEqual(b);
    await expect(verifyPassword('same-password', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password', b)).resolves.toBe(true);
  });

  it('embeds the cost parameters so the stored format is self-describing', async () => {
    const hash = await hashPassword('pw');
    expect(hash).toMatch(/^scrypt:16384:8:1:[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it('rejects malformed/garbage stored hashes instead of throwing', async () => {
    await expect(verifyPassword('pw', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPassword('pw', 'scrypt:not:numeric:params:00:00')).resolves.toBe(false);
    await expect(verifyPassword('pw', '')).resolves.toBe(false);
  });
});
