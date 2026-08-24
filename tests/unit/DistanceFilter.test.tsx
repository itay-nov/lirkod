// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DistanceFilter, type DistanceFilterLabels } from "@/components/DistanceFilter";

const LABELS: DistanceFilterLabels = {
  legend: "מרחק לחיפוש",
  options: [
    { radiusMeters: 5_000, label: "עד 5 ק״מ" },
    { radiusMeters: 15_000, label: "עד 15 ק״מ" },
    { radiusMeters: 30_000, label: "עד 30 ק״מ" },
    { radiusMeters: 50_000, label: "עד 50 ק״מ" },
  ],
  updating: "מעדכנים",
  updateFailed: "לא הצלחנו לעדכן",
};

afterEach(cleanup);

describe("DistanceFilter", () => {
  it("renders one native radio group with the applied radius checked", () => {
    render(
      <DistanceFilter radiusMeters={15_000} onChange={() => undefined} labels={LABELS} />,
    );

    expect(screen.getByRole("group", { name: LABELS.legend })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "עד 15 ק״מ" })).toBeChecked();
  });

  it("reports a changed radius through the visible radio control", () => {
    const onChange = vi.fn();
    render(<DistanceFilter radiusMeters={15_000} onChange={onChange} labels={LABELS} />);

    fireEvent.click(screen.getByRole("radio", { name: "עד 50 ק״מ" }));
    expect(onChange).toHaveBeenCalledWith(50_000);
  });

  it("announces progress and a failure in words", () => {
    const { rerender } = render(
      <DistanceFilter
        radiusMeters={15_000}
        onChange={() => undefined}
        labels={LABELS}
        busy
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(LABELS.updating);

    rerender(
      <DistanceFilter
        radiusMeters={15_000}
        onChange={() => undefined}
        labels={LABELS}
        failed
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(LABELS.updateFailed);
  });
});
