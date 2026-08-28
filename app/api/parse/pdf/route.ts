import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { parsePdfText, pdfTableToParsedTable, groupTablesByHeader, type ParsedTable } from "@/lib/parseBankStatement";

const NO_TRANSACTIONS_ERROR =
  "Couldn't find any transaction lines in this PDF. It may be a scanned image rather than a digital export — try uploading a CSV or XLSX instead.";

export async function POST(request: NextRequest) {
  const arrayBuffer = await request.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    return NextResponse.json({ error: "No PDF data received." }, { status: 400 });
  }

  const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
  try {
    // Prefer real detected table cells (from the PDF's actual grid lines) over inferring
    // columns from plain text — this correctly distinguishes an "Amount" column from a
    // trailing "Balance" column, the same way CSV/XLSX headers already do.
    // getTable() detects one grid per page rather than assuming a repeated-header table
    // continues across pages, so a multi-page statement needs those grids merged by header
    // before picking the transactions table — otherwise only whichever page's grid happens
    // to be largest survives, silently truncating everything else.
    const tableResult = await parser.getTable();
    const rawGrids = tableResult.pages.flatMap((page) => page.tables);
    const candidateGrids = groupTablesByHeader(rawGrids);

    let bestTable: ParsedTable | null = null;
    for (const grid of candidateGrids) {
      const parsed = pdfTableToParsedTable(grid);
      if (parsed && (!bestTable || parsed.rows.length > bestTable.rows.length)) {
        bestTable = parsed;
      }
    }

    if (bestTable && bestTable.rows.length > 0) {
      return NextResponse.json(bestTable);
    }

    // Fall back to line-based text heuristics for statements with no visible table grid.
    const textResult = await parser.getText();
    const table = parsePdfText(textResult.text);

    if (table.rows.length === 0) {
      return NextResponse.json({ error: NO_TRANSACTIONS_ERROR }, { status: 422 });
    }

    return NextResponse.json(table);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse this PDF." },
      { status: 500 }
    );
  } finally {
    await parser.destroy();
  }
}
