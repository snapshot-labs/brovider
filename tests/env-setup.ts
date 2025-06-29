let loopPromise: Promise<void> | null = null;

// Start the data loop in tests
beforeAll(async () => {
  const { run } = await import('../src/helpers/data');
  // Start the background loop and store the promise
  loopPromise = run();
  // Give it time to load data
  await new Promise(resolve => setTimeout(resolve, 2000));
}, 5000);

// Stop the loop after each test file
afterAll(async () => {
  const { stop } = await import('../src/helpers/data');
  stop();
  // Wait for the loop to actually stop
  if (loopPromise) {
    await loopPromise;
  }
});
