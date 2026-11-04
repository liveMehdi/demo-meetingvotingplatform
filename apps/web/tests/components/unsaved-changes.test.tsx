import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/lib/UnsavedChanges";

function setup(pending = false) {
  function Editor() {
    const [value, setValue] = useState("");
    useUnsavedChanges(value !== "", pending);

    return (
      <>
        <label>
          Draft
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <Link to="/other">Other page</Link>
      </>
    );
  }

  const router = createMemoryRouter([
    {
      element: (
        <UnsavedChangesProvider>
          <Outlet />
        </UnsavedChangesProvider>
      ),
      children: [
        { path: "/", element: <Editor /> },
        { path: "/other", element: <h1>Other page</h1> },
      ],
    },
  ]);

  render(<RouterProvider router={router} />);
}

test("dirty forms let the user stay or explicitly discard before navigating", async () => {
  setup();

  const user = userEvent.setup();

  await user.type(screen.getByLabelText("Draft"), "Unfinished draft");
  await user.click(screen.getByRole("link", { name: "Other page" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Leave unsaved changes?",
  });

  await user.click(within(dialog).getByRole("button", { name: "Stay here" }));
  expect(screen.getByLabelText("Draft")).toHaveValue("Unfinished draft");
  await user.click(screen.getByRole("link", { name: "Other page" }));

  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Discard and leave",
    }),
  );

  expect(
    await screen.findByRole("heading", { name: "Other page" }),
  ).toBeVisible();
});

test("navigation cannot discard a save that is still pending", async () => {
  setup(true);

  await userEvent
    .setup()
    .click(screen.getByRole("link", { name: "Other page" }));

  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Discard and leave" }),
  ).toBeDisabled();

  expect(dialog).toHaveTextContent("A save is still running");
});

test("clean forms navigate without a warning", async () => {
  setup();

  await userEvent
    .setup()
    .click(screen.getByRole("link", { name: "Other page" }));
  expect(
    await screen.findByRole("heading", { name: "Other page" }),
  ).toBeVisible();

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
