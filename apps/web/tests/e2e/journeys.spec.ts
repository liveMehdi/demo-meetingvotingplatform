import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const password = "purpleblue4112";
const test = base.extend<{ officerApi: APIRequestContext }>({
  officerApi: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({
      baseURL: "http://127.0.0.1:5174",
      extraHTTPHeaders: {
        Origin: "http://127.0.0.1:5174",
        "X-CSRF-Protection": "1",
      },
    });

    const login = await api.post("/api/auth/login", {
      data: { email: "shan@example.org", password },
    });

    await expect(login).toBeOK();
    await use(api);

    await api.dispose();
  },
});

test("demo admin signs in and keeps its account access protected", async ({ page }) => {
  await page.goto("/login");

  await page.getByRole("button", { name: "Use demo admin account" }).click();

  await expect(page.getByLabel("Email")).toHaveValue("tyrone@example.org");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/members?q=tyrone%40example.org");

  await expect(page.getByText(/password and account security settings are protected/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke membership" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove officer access" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Suspend account" })).toHaveCount(0);
});

async function signIn(page: Page, role: "officer" | "member") {
  await page.goto("/login");
  const name = role === "officer" ? "shan" : "jonny";

  await page.getByLabel("Email").fill(`${name}@example.org`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).not.toHaveURL(/\/login/);
}

async function meeting(
  api: APIRequestContext,
  title: string,
): Promise<{ id: string }> {
  const response = await api.post("/api/meetings", {
    data: {
      title,
      description: "Browser test",
      scheduled_at: new Date().toISOString(),
    },
  });

  await expect(response).toBeOK();

  return response.json();
}

test("member signs in, votes, receives confirmation and sees published results", async ({
  page,
  officerApi,
}) => {
  const m = await meeting(officerApi, "Member voting journey");

  const response = await officerApi.post(`/api/meetings/${m.id}/ballots`, {
    data: {
      kind: "election",
      question: "Choose the browser-test chair",
      options: ["Tyrone", "Shan"],
    },
  });

  await expect(response).toBeOK();

  const ballot = await response.json();
  const path = `/api/meetings/${m.id}/ballots/${ballot.id}`;

  await expect(
    await officerApi.post(`${path}/open`, {
      data: {
        expected_revision: 1,
        expected_eligibility_revision: 1,
      },
    }),
  ).toBeOK();

  await signIn(page, "member");

  await page.getByRole("link", { name: "Your ballots", exact: true }).click();

  await page
    .getByRole("link", { name: /Choose the browser-test chair/ })
    .click();
  await page.getByRole("radio", { name: "Tyrone", exact: true }).check();
  await page.getByRole("button", { name: "Review submission" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();

  await expect(
    page.getByText("Your submission is recorded. It cannot be changed."),
  ).toBeVisible();

  await expect(page.getByRole("radio")).toHaveCount(0);

  await expect(
    page.getByRole("region", { name: "Published results" }),
  ).toHaveCount(0);

  await expect(await officerApi.post(`${path}/close`)).toBeOK();

  await expect(await officerApi.post(`${path}/publish`)).toBeOK();
  await page.getByRole("button", { name: "Refresh status" }).click();
  const results = page.getByRole("region", { name: "Published results" });
  await expect(results).toBeVisible();

  await expect(results).toContainText("Most votes: Tyrone.");
});

test("officer creates, opens, closes and publishes a ballot through the interface", async ({
  page,
  officerApi,
}) => {
  const m = await meeting(officerApi, "Officer management journey");

  await signIn(page, "officer");
  await page.goto(`/meetings/${m.id}`);
  await page.getByRole("button", { name: "Create election or motion" }).click();
  await page
    .getByLabel("Question", { exact: true })
    .fill("Elect the test secretary");

  await page.getByLabel(/Options.*one per line/).fill("Tyrone\nShan");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();

  await expect(
    page.getByText("Draft saved: Elect the test secretary"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Review opening" }).click();
  await page.getByRole("button", { name: "Confirm opening" }).click();
  await expect(
    page.getByText(/Ballot opened with .* eligible members/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Close voting", exact: true }).click();

  await page.getByRole("button", { name: "Confirm closing" }).click();

  await expect(
    page.getByText("Voting closed. Results remain unpublished."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Review publication" }).click();
  await page.getByRole("button", { name: "Confirm publication" }).click();
  await expect(
    page.getByRole("region", { name: "Published results" }),
  ).toContainText("No votes were cast.");
});

test("guest joins using the QR link, answers a poll and updates live projector totals", async ({
  page,
  browser,
  officerApi,
}) => {
  const m = await meeting(officerApi, "Guest polling journey");

  const joining = await officerApi.put(`/api/meetings/${m.id}/guest-joining`, {
    data: { enabled: true, expected_revision: 1 },
  });

  await expect(joining).toBeOK();

  const code = (await joining.json()).code;

  const created = await officerApi.post(`/api/meetings/${m.id}/polls`, {
    data: {
      kind: "poll_single",
      question: "Which refreshment?",
      options: ["Tea", "Coffee"],
    },
  });

  await expect(created).toBeOK();

  const poll = await created.json();

  await expect(
    await officerApi.post(`/api/meetings/${m.id}/polls/${poll.id}/open`, {
      data: { expected_revision: 1 },
    }),
  ).toBeOK();

  const officerContext = await browser.newContext();

  const projector = await officerContext.newPage();
  try {
    await signIn(projector, "officer");

    await projector.goto(`/meetings/${m.id}/polls/${poll.id}/projector`);

    const joinLink = projector.getByLabel("Meeting join link");
    await expect(joinLink).toHaveValue(`http://127.0.0.1:5174/join#${code}`);
    await expect(projector.getByText(/0 responses/)).toBeVisible();

    await page.goto(await joinLink.inputValue());

    await expect(page.getByLabel("Meeting code")).toHaveValue(code);
    await page.getByRole("button", { name: "Join meeting" }).click();
    await expect(
      page.getByRole("heading", { name: "Guest polling journey" }),
    ).toBeVisible();

    await expect(page.getByText("Live updates connected")).toBeVisible();
    await page.getByRole("radio", { name: "Tea", exact: true }).check();
    await page.getByRole("button", { name: "Submit response" }).click();
    await expect(
      page.getByText("Your response has been recorded. It cannot be changed."),
    ).toBeVisible();

    await expect(
      page.locator("p").filter({ hasText: /^Responses:/ }),
    ).toHaveText(/Responses:\s*1/);
    // the other browser gets the new totals without refreshing the page
    await expect(projector.getByText(/1 responses/)).toBeVisible();
  } finally {
    await officerContext.close();
  }
});
