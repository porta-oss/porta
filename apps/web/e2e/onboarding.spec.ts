if (!process.versions?.bun) {
  const { expect, test } = await import('@playwright/test');

  test.describe('onboarding flow scaffold', () => {
    test('reserves the browser verification entrypoint for the real onboarding flow', async () => {
      test.skip(true, 'T01 only scaffolds the e2e harness; T05 wires the real authenticated flow.');

      await expect('pending').toContain('pending');
    });
  });
}

export {};
