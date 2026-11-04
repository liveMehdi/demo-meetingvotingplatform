import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { RankingInput } from "@/features/ballots/RankingInput";

test("candidates can be ranked, reordered and removed without duplicates", async () => {
  function Harness() {
    const [value, setValue] = useState<string[]>([]);

    return (
      <RankingInput
        options={[
          { id: "a", label: "Tyrone" },
          { id: "b", label: "Shan" },
        ]}
        value={value}
        onChange={setValue}
      />
    );
  }

  render(<Harness />);

  const user = userEvent.setup();

  await user.click(
    screen.getByRole("button", { name: "Add Tyrone at rank 1" }),
  );

  expect(
    screen.queryByRole("button", { name: /Add Tyrone/ }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Add Shan at rank 2" }));

  expect(screen.getByRole("button", { name: "Move Tyrone up" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Shan down" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Move Shan up" }));
  const rows = within(
    screen.getByRole("list", { name: "Your ranking" }),
  ).getAllByRole("listitem");

  expect(rows[0]).toHaveTextContent("1. Shan");
  expect(rows[1]).toHaveTextContent("2. Tyrone");
  await user.click(
    screen.getByRole("button", { name: "Remove Shan from ranking" }),
  );

  expect(
    screen.getByRole("button", { name: "Add Shan at rank 2" }),
  ).toBeEnabled();

  expect(screen.getByRole("list", { name: "Your ranking" })).toHaveTextContent(
    "1. Tyrone",
  );
});
