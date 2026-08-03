import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import { he } from "@/lib/i18n/he";

describe("HomePage", () => {
  it("renders the Hebrew placeholder text, proving the Vitest harness runs", () => {
    render(<HomePage />);
    expect(screen.getByText(he.common.appName)).toBeInTheDocument();
  });
});
