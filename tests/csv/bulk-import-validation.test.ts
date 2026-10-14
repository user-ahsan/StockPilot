import { describe, expect, it, vi } from 'vitest';
import { escapeCsvCellForExport, hasFormulaInjection } from '../../src/lib/validators/csv.schema';
import {
  commitValidRows,
  InMemoryCsvCommitAdapter,
  validateCsv,
} from '../../src/server/services/csv-import.service';

// `server-only` throws outside a React Server bundle — neutralise it for tests.
vi.mock('server-only', () => ({}));

const HEADER =
  'sku,name,brand,category,supplier_code,unit_cost,selling_price,currency,reorder_point,reorder_qty,barcode_upc';

const KNOWN_SUPPLIER_CODES = new Set([
  'SUP-TECH',
  'SUP-SVW',
  'SUP-GPU',
  'SUP-MEM',
  'SUP-STOR',
  'SUP-PWR',
]);

const ACTOR = { memberId: 'm1', role: 'OWNER' as const, correlationId: 'corr-csv' };

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\r\n');
}

describe('CSV formula-injection guarding (Rule 114)', () => {
  it('detects every dangerous leading character, raw or trimmed', () => {
    for (const dangerous of ['=1+1', '+SUM(A1)', '-1+1', '@import', '\tcmd', '\rboom', '   =cmd']) {
      expect(hasFormulaInjection(dangerous)).toBe(true);
    }
    expect(hasFormulaInjection('Normal Text')).toBe(false);
  });

  it('blocks formula cells in text columns of an uploaded CSV', () => {
    const result = validateCsv({
      csvText: csv(
        `=CMD(),Injected,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`,
        `PLUS-SKU,+SUM(A1),Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`,
        `MINUS-SKU,-1+1,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`,
        `AT-SKU,@import,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`,
      ),
      knownSupplierCodes: KNOWN_SUPPLIER_CODES,
    });

    expect(result.summary.validCount).toBe(0);
    expect(result.summary.invalidCount).toBe(4);
    for (const row of result.invalidRows) {
      expect(row.errors.some((error) => error.code === 'FORMULA_INJECTION_BLOCKED')).toBe(true);
    }
  });
});

describe('CSV intra-file duplicate detection (Rule 116)', () => {
  it('flags the second occurrence and references the first row number', () => {
    const result = validateCsv({
      csvText: csv(
        `DUP-SKU,First,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`,
        `DUP-SKU,Second,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`,
        `OK-SKU,Third,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`,
      ),
      knownSupplierCodes: KNOWN_SUPPLIER_CODES,
    });

    expect(result.summary.validCount).toBe(2);
    expect(result.summary.invalidCount).toBe(1);
    expect(result.summary.duplicateSkusInFile).toBe(1);
    expect(result.invalidRows[0].rowNumber).toBe(3);
    expect(result.invalidRows[0].errors[0].code).toBe('DUPLICATE_SKU_IN_CSV');
    expect(result.invalidRows[0].errors[0].message).toContain('row 2');
  });
});

describe('CSV field validation (Rules 115–117)', () => {
  it('rejects negative prices, bad currencies, malformed SKUs and unknown suppliers', () => {
    const result = validateCsv({
      csvText: csv(
        `NEG-SKU,Negative,Acme,GPUs,SUP-GPU,-45.00,20.00,USD,5,10,`,
        `CUR-SKU,BadCurrency,Acme,GPUs,SUP-GPU,10.00,20.00,JPY,5,10,`,
        `bad sku,BadSku,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`,
        `SUP-SKU,UnknownVendor,Acme,GPUs,SUP-NOPE,10.00,20.00,USD,5,10,`,
        `ZERO-QTY,ZeroReorderQty,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,0,`,
      ),
      knownSupplierCodes: KNOWN_SUPPLIER_CODES,
    });

    expect(result.summary.invalidCount).toBe(5);
    const codes = result.invalidRows.flatMap((row) => row.errors.map((error) => error.code));
    expect(codes).toContain('NEGATIVE_AMOUNT');
    expect(codes).toContain('INVALID_CURRENCY');
    expect(codes).toContain('MALFORMED_SKU');
    expect(codes).toContain('UNKNOWN_SUPPLIER');
    expect(codes).toContain('MUST_BE_POSITIVE');
  });

  it('flags header errors when required columns are missing', () => {
    const result = validateCsv({
      csvText: ['sku,name', 'A-SKU,Thing'].join('\r\n'),
      knownSupplierCodes: KNOWN_SUPPLIER_CODES,
    });
    expect(result.headerErrors.length).toBeGreaterThan(0);
    expect(result.summary.validCount).toBe(0);
  });
});

describe('Mixed 100-row batch (85 valid + 15 invalid) with idempotent commit', () => {
  function buildMixedBatch(): string {
    const rows: string[] = [];
    for (let index = 0; index < 100; index++) {
      const rowNumber = index + 2;
      if (index % 7 === 0) {
        const variant = (index / 7) % 5;
        if (variant === 0) rows.push(`SAMPLE-X${rowNumber},=CMD(),Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`);
        else if (variant === 1) rows.push(`bad sku ${rowNumber},Broken,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`);
        else if (variant === 2) rows.push(`SAMPLE-X${rowNumber},Negative,Acme,GPUs,SUP-GPU,-45.00,20.00,USD,5,10,`);
        else if (variant === 3) rows.push(`SAMPLE-X${rowNumber},BadCurrency,Acme,GPUs,SUP-GPU,10.00,20.00,JPY,5,10,`);
        else rows.push(`SAMPLE-X${rowNumber},UnknownVendor,Acme,GPUs,SUP-NOPE,10.00,20.00,USD,5,10,`);
      } else {
        rows.push(`SAMPLE-${String(rowNumber).padStart(4, '0')},Product ${rowNumber},Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`);
      }
    }
    return csv(...rows);
  }

  it('isolates the 15 invalid rows with exact row numbers and commits 85 rows idempotently', async () => {
    const csvText = buildMixedBatch();
    const result = validateCsv({ csvText, knownSupplierCodes: KNOWN_SUPPLIER_CODES });

    expect(result.headerErrors).toEqual([]);
    expect(result.summary.totalRows).toBe(100);
    expect(result.summary.validCount).toBe(85);
    expect(result.summary.invalidCount).toBe(15);
    expect(result.invalidRows.map((row) => row.rowNumber)).toEqual([
      2, 9, 16, 23, 30, 37, 44, 51, 58, 65, 72, 79, 86, 93, 100,
    ]);
    for (const row of result.invalidRows) expect(row.errors.length).toBeGreaterThan(0);

    // Deterministic validation token.
    expect(validateCsv({ csvText, knownSupplierCodes: KNOWN_SUPPLIER_CODES }).validationToken).toBe(
      result.validationToken,
    );

    const adapter = new InMemoryCsvCommitAdapter();
    const meta = { adapter, rejectedInvalidCount: 15, totalUploaded: 100 };

    const first = await commitValidRows('org-1', ACTOR, result.validRows, meta);
    expect(first.importedValidCount).toBe(85);
    expect(first.rejectedInvalidCount).toBe(15);
    expect(first.totalUploaded).toBe(100);

    // Re-committing the same batch is a no-op (idempotent by SKU).
    const second = await commitValidRows('org-1', ACTOR, result.validRows, meta);
    expect(second.importedValidCount).toBe(0);
    expect(second.skippedExistingCount).toBe(85);
    expect(adapter.committedSkus.size).toBe(85);
  });
});

describe('CSV export escaping (Rule 119)', () => {
  it('prefixes formula cells and RFC-4180 quotes delimiters', () => {
    expect(escapeCsvCellForExport('=CMD()')).toBe("'=CMD()");
    expect(escapeCsvCellForExport('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvCellForExport('@import')).toBe("'@import");
    expect(escapeCsvCellForExport('a,b')).toBe('"a,b"');
    expect(escapeCsvCellForExport('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCellForExport(null)).toBe('');
    expect(escapeCsvCellForExport(1299)).toBe('1299');
  });
});
