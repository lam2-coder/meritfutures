// =============================================================================
// packages/enrichment/test/contract.test.ts
// =============================================================================
// THE ALLOWLIST, ASSERTED IN BOTH DIRECTIONS.
//
// `SD-M10-01` states the failure in the direction that matters: "nobody decides
// to leak the new column. Someone adds a column to an event payload for an
// unrelated reason, and the vendor starts receiving it that afternoon." An
// assertion that a permitted field IS sent proves nothing about that; the
// assertion that carries the control is that a field the row does not name is
// NOT sent, and it is watched here against a row that names four of five and
// against one that names none.

import { describe, expect, test } from 'vitest';

import {
  ENRICHMENT_CONTRACT_VERSION,
  ENRICHMENT_EVENT_NAME,
  ENRICHMENT_FIELD_ALLOWLIST,
  ENRICHMENT_INTEGRATION,
  enrichmentContractValues,
  liveContractFrom,
  readLiveContract,
  redactToAllowlist,
  type ContractRow,
} from '../src/contract.ts';
import { ENRICHMENT_FACETS, type EnrichmentSubject } from '../src/port.ts';

const FULL_SUBJECT: EnrichmentSubject = {
  email_footprint: 'buyer@example.test',
  phone_footprint: '+15550100',
  device: 'device-abc',
  ip: '203.0.113.7',
  bin: '424242',
};

function row(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    integration: ENRICHMENT_INTEGRATION,
    eventName: ENRICHMENT_EVENT_NAME,
    fieldAllowlist: [...ENRICHMENT_FIELD_ALLOWLIST],
    enabled: true,
    version: ENRICHMENT_CONTRACT_VERSION,
    ...overrides,
  };
}

describe('the allowlist is an allowlist and not a denylist', () => {
  test('a facet the row does not name is NOT sent, and is not in `fields_sent`', () => {
    const redacted = redactToAllowlist(row({ fieldAllowlist: ['ip', 'bin'] }), FULL_SUBJECT);

    expect(redacted.subject).toEqual({ ip: '203.0.113.7', bin: '424242' });
    expect(redacted.fieldsSent).toEqual(['ip', 'bin']);
  });

  test('an EMPTY allowlist sends nothing at all', () => {
    const redacted = redactToAllowlist(row({ fieldAllowlist: [] }), FULL_SUBJECT);

    expect(redacted.subject).toEqual({});
    expect(redacted.fieldsSent).toEqual([]);
  });

  test('`fields_sent` is what WENT and not what the row permitted', () => {
    // The DDL's own distinction: "The two can differ when a field is absent
    // from a particular event, and the breach question is about what left the
    // building rather than about what was allowed to."
    const redacted = redactToAllowlist(row(), { ip: '203.0.113.7' });

    expect(redacted.fieldsSent).toEqual(['ip']);
    expect(redacted.subject).toEqual({ ip: '203.0.113.7' });
  });

  test('the order is the closed vocabulary and not the caller key order', () => {
    const reversed: EnrichmentSubject = {
      bin: '424242',
      ip: '203.0.113.7',
      device: 'device-abc',
      phone_footprint: '+15550100',
      email_footprint: 'buyer@example.test',
    };

    expect(redactToAllowlist(row(), reversed).fieldsSent).toEqual([...ENRICHMENT_FACETS]);
  });

  test('a name the row permits that this integration cannot produce is REPORTED', () => {
    const redacted = redactToAllowlist(
      row({ fieldAllowlist: ['ip', 'passport_number', 'wallet_balance_cents'] }),
      FULL_SUBJECT,
    );

    // It discloses nothing, because nothing here can produce a value for it. It
    // is surfaced because a contract permitting a field the caller cannot send
    // is a drift between the approval and the code.
    expect(redacted.subject).toEqual({ ip: '203.0.113.7' });
    expect(redacted.unknownAllowlistNames).toEqual(['passport_number', 'wallet_balance_cents']);
  });

  test('the declared allowlist is exactly ADR-023 purchased scope and not one field more', () => {
    expect([...ENRICHMENT_FIELD_ALLOWLIST]).toEqual([...ENRICHMENT_FACETS]);
  });
});

describe('the live contract', () => {
  test('a DISABLED row does not govern anything', () => {
    expect(liveContractFrom([row({ enabled: false })])).toBeUndefined();
  });

  test("another integration's enabled row is not this one", () => {
    expect(liveContractFrom([row({ integration: 'loops' })])).toBeUndefined();
  });

  test("the registration lookup's row is a different MOMENT and is not this one", () => {
    // M03 section 7.9.1: one vendor, two moments, a separate row each.
    expect(liveContractFrom([row({ eventName: 'registration.phone_lookup' })])).toBeUndefined();
  });

  test('TWO enabled rows THROW rather than one of them being picked', () => {
    expect(() => liveContractFrom([row(), row({ version: 2 })])).toThrow(
      /integration_contracts_live_uq/,
    );
  });

  test('a row of the wrong shape says exactly what arrived', () => {
    expect(() => liveContractFrom([{ integration: ENRICHMENT_INTEGRATION }])).toThrow(
      /does not carry integration and eventName as strings/,
    );
    expect(() => liveContractFrom([{ ...row(), fieldAllowlist: 'ip' }])).toThrow(
      /fieldAllowlist as an array of strings/,
    );
    expect(() => liveContractFrom([{ ...row(), enabled: 'yes' }])).toThrow(/enabled as a boolean/);
  });

  test('it is read through a handle that names only the firm table', async () => {
    const source = {
      rows: (key: 'integrationContracts') =>
        Promise.resolve([
          row({ integration: key === 'integrationContracts' ? ENRICHMENT_INTEGRATION : 'x' }),
        ]),
    };

    await expect(readLiveContract(source)).resolves.toMatchObject({
      integration: ENRICHMENT_INTEGRATION,
      enabled: true,
    });
  });
});

describe('the row is installed DISABLED and by a named person', () => {
  test('`enabled` is false and is not a parameter', () => {
    const values = enrichmentContractValues('founder', new Date('2026-08-26T00:00:00Z'));

    expect(values['enabled']).toBe(false);
  });

  test('it carries the approver and the date, both of them required', () => {
    const approvedAt = new Date('2026-08-26T00:00:00Z');
    const values = enrichmentContractValues('founder', approvedAt);

    expect(values['approvedBy']).toBe('founder');
    expect(values['approvedAt']).toBe(approvedAt);
  });

  test('an EMPTY approver is refused, because it satisfies the column and names nobody', () => {
    expect(() => enrichmentContractValues('   ', new Date())).toThrow(/needs an approver/);
  });

  test('no `guard_expression` is set, because observe mode asks about every checkout', () => {
    const values = enrichmentContractValues('founder', new Date());

    expect(values).not.toHaveProperty('guardExpression');
  });

  test('the values name every NOT NULL column the DDL declares without a default', () => {
    const values = enrichmentContractValues('founder', new Date());

    expect(Object.keys(values).sort()).toEqual([
      'approvedAt',
      'approvedBy',
      'enabled',
      'eventName',
      'fieldAllowlist',
      'integration',
      'version',
    ]);
  });

  test('the allowlist is COPIED rather than shared, so a caller cannot edit the declaration', () => {
    const values = enrichmentContractValues('founder', new Date());
    const written = values['fieldAllowlist'];

    expect(written).not.toBe(ENRICHMENT_FIELD_ALLOWLIST);
    expect(written).toEqual([...ENRICHMENT_FIELD_ALLOWLIST]);
  });
});
