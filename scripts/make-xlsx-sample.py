"""Write the Excel sample price sheet (public/samples/q1-2027/vendor-d.xlsx).

Real quotes arrive as workbooks with a letterhead above the table, numeric
cells, and a total row, so the sample has all three. Requires openpyxl:
    python3 scripts/make-xlsx-sample.py
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

out = Path(__file__).resolve().parent.parent / "public" / "samples" / "q1-2027" / "vendor-d.xlsx"

wb = Workbook()
ws = wb.active
ws.title = "Quote"
ws.append(["Vendor D: Quotation for Q1 2027 distribution materials re-bid"])
ws["A1"].font = Font(bold=True, size=14)
ws.append(["Synthetic sample. Prices valid 60 days."])
ws.append([])
ws.append(["Line #", "Material Description", "Quantity", "UOM", "Unit Cost", "Lead Time"])
rows = [
    (10, "Cable, primary, 15kV, #1/0 AL, 133% EPR, URD", 15, "M", 2710, "4-6 weeks"),
    (11, "Cable, primary, 15kV, 750 KCMIL AL, 100% EPR", 4, "M", 10480, "6 weeks"),
    (12, "Conductor, bare, ACSR, 336.4 KCMIL, 26/7, LINNET", 12, "M", 1330, "3 weeks"),
    (13, "Conductor, bare, ACSR, #4/0, 6/1, PENGUIN", 8, "M", 905, "3 weeks"),
]
for r in rows:
    ws.append(list(r))
for cell in ws["E"][4:]:
    cell.number_format = '"$"#,##0.00'
ws.append([])
ws.append([None, "Total", None, None, "=SUMPRODUCT(C5:C8,E5:E8)", None])
out.parent.mkdir(parents=True, exist_ok=True)
wb.save(out)
print(f"wrote {out}")
