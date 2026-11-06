import { ExportService, neutralizeFormula } from "./export.service";

describe("export formula safety", () => {
  it("neutralises text a spreadsheet would run as a formula", () => {
    expect(neutralizeFormula('=HYPERLINK("http://evil","x")')).toBe(`'=HYPERLINK("http://evil","x")`);
    expect(neutralizeFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeFormula("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
    expect(neutralizeFormula("\tTabbed")).toBe("'\tTabbed");
  });

  it("leaves ordinary text and numbers (including negatives) alone", () => {
    expect(neutralizeFormula("Mighty Patch")).toBe("Mighty Patch");
    expect(neutralizeFormula("-3")).toBe("-3");
    expect(neutralizeFormula("12.50")).toBe("12.50");
    expect(neutralizeFormula("")).toBe("");
  });

  it("applies to CSV exports end to end", async () => {
    const result = await new ExportService().build(
      "csv",
      "t",
      [
        { header: "Name", key: "name" },
        { header: "Qty", key: "qty" },
      ],
      [{ name: "=2+2", qty: "-4" }],
    );
    expect(result.buffer.toString("utf8")).toBe("Name,Qty\n'=2+2,-4");
  });
});
