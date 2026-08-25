// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileNavDrawer } from "@/components/ProfileNavDrawer";
import { he } from "@/lib/i18n/he";

afterEach(cleanup);

function openDrawer() {
  const opener = screen.getByRole("button", { name: he.profileMenu.open });
  fireEvent.click(opener);
  return opener;
}

describe("ProfileNavDrawer", () => {
  it("offers shared destinations to a dancer but not the instructor-only form", () => {
    render(<ProfileNavDrawer role="dancer" />);
    openDrawer();

    expect(screen.getByRole("link", { name: he.profileMenu.home })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: he.profileMenu.myArea })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(
      screen.queryByRole("link", { name: he.profileMenu.createDance }),
    ).not.toBeInTheDocument();
  });

  it("offers the existing create form only to an instructor", () => {
    render(<ProfileNavDrawer role="instructor" />);
    openDrawer();

    expect(
      screen.getByRole("link", { name: he.profileMenu.createDance }),
    ).toHaveAttribute("href", "/profile/create-dance");
  });

  it("moves focus into the drawer, traps Tab, and Escape closes back to the opener", async () => {
    render(<ProfileNavDrawer role="instructor" />);
    const opener = openDrawer();
    const close = screen.getByRole("button", { name: he.profileMenu.close });
    const lastLink = screen.getByRole("link", { name: he.profileMenu.createDance });

    expect(close).toHaveFocus();
    lastLink.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
