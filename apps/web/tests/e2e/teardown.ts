export default async function teardown() {
  // these shutdown routes are only used by the test servers
  // trying to stop both servers even if one has already failed
  const results = await Promise.allSettled(
    [8001, 5174].map(async (port) => {
      const response = await fetch(
        `http://127.0.0.1:${port}/__test__/shutdown`,
        {
          method: "POST",
          headers: {
            Origin: "http://127.0.0.1:5174",
            "X-CSRF-Protection": "1",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok)
        throw new Error(`Test server cleanup failed on port ${port}.`);
    }),
  );

  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
