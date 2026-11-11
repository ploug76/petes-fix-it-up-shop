import assert from 'node:assert/strict';
import test from 'node:test';
import { scan } from '../src/engine.mjs';
import {
  bureauLetter,
  explainBureau,
  explainMov,
  furnisherLetter,
  movLetter,
  reviewClaim,
} from '../src/letters.mjs';
import { DATE_LINE, report, tradeline } from './people.mjs';

function ids(findings) {
  return findings.map((finding) => finding.id.replace(/^.*?:/, ''));
}

function mailed(findings) {
  return findings.filter((finding) => finding.mail);
}

function assertNoIdentity(text) {
  assert.doesNotMatch(text, /not mine|isn.?t mine|does not belong to me/i);
}

test('payment grid and last-payment date are argued together', () => {
  const file = report([
    tradeline('finn', 'transunion', {
      creditor: 'Cedar Visa',
      accountNumber: '****6603',
      status: 'Charge-off',
      isChargeOff: true,
      dateOpened: '2019-11-01',
      dateClosed: '2024-06-30',
      chargeOffDate: '2024-06-30',
      dofd: '2024-03-01',
      dateOfLastPayment: '2024-06-18',
      balance: 1500,
      pastDue: 1500,
      paymentHistory: [
        { ym: '2024-03', code: '30' },
        { ym: '2024-04', code: '60' },
        { ym: '2024-05', code: '90' },
        { ym: '2024-06', code: 'CO' },
      ],
    }),
  ]);
  const findings = scan(file);
  assert.ok(ids(findings).includes('last-pay-late'));
  const letter = bureauLetter(file, 'transunion', findings, file.tradelines, DATE_LINE);
  assert.match(letter, /Why these codes cannot all be true/);
  assert.match(letter, /Field 18/);
  assert.match(letter, /Field 27/);
  assert.match(letter, /2024-06/);
  assert.match(letter, /CO/);
  assert.match(letter, /15 U\.S\.C\. §1681i/);
  assertNoIdentity(letter);
  const explain = explainBureau(file, 'transunion', findings);
  assert.match(explain, /Why this letter/);
  assert.match(explain, /payment grid/i);
  assertNoIdentity(explain);
  const follow = movLetter(file, 'transunion', findings, file.tradelines, DATE_LINE);
  assert.doesNotMatch(follow, /Why these codes cannot all be true/);
  assert.match(follow, /does not repeat that dispute/);
  assert.match(follow, /Who you contacted/);
  assert.match(follow, /What you sent them/);
  assert.match(follow, /What they sent back/);
  assert.match(follow, /2024-06/);
  assert.match(explainMov(file, 'transunion', findings), /who was contacted/i);
  const furnisher = furnisherLetter(file, 'Cedar Visa', findings, file.tradelines, DATE_LINE);
  assert.match(furnisher, /12 C\.F\.R\. §1022\.43/);
  assert.match(furnisher, /§1681s-2/);
  assert.match(furnisher, /Why these codes cannot all be true/);
});

test('first delinquency later than the grid is a coding break, not a request to re-age', () => {
  const file = report([
    tradeline('ada', 'equifax', {
      creditor: 'Lumen Card',
      accountNumber: '****1001',
      status: 'Charge-off',
      isChargeOff: true,
      dateOpened: '2019-02-01',
      dateClosed: '2024-01-15',
      chargeOffDate: '2024-01-15',
      dofd: '2025-03-01',
      balance: 1800,
      pastDue: 1800,
      paymentHistory: [
        { ym: '2023-11', code: 'OK' },
        { ym: '2023-12', code: '30' },
        { ym: '2024-01', code: '60' },
        { ym: '2025-03', code: '60' },
      ],
    }),
  ]);
  const findings = scan(file);
  assert.ok(ids(findings).includes('dofd-reage'));
  assert.ok(ids(findings).includes('dofd-after-chargeoff'));
  const letter = bureauLetter(file, 'equifax', findings, file.tradelines, DATE_LINE);
  assert.match(letter, /Field 25/);
  assert.match(letter, /2023-12/);
  assert.match(letter, /cannot be later than that chain/);
  assert.match(letter, /not asking you to move an earlier date later/);
  assertNoIdentity(letter);
});

test('an earlier delinquency date is refused and is not put in a letter', () => {
  const file = report([
    tradeline('early', 'experian', {
      creditor: 'Old Store Card',
      accountNumber: '****8802',
      status: 'Charge-off',
      isChargeOff: true,
      dateOpened: '2020-03-01',
      dofd: '2024-01-01',
      chargeOffDate: '2024-09-01',
      dateClosed: '2024-09-01',
      balance: 500,
      pastDue: 500,
      paymentHistory: [
        { ym: '2024-01', code: 'OK' },
        { ym: '2024-02', code: 'OK' },
        { ym: '2024-03', code: '30' },
        { ym: '2024-04', code: '60' },
        { ym: '2024-05', code: '90' },
        { ym: '2024-06', code: '120' },
        { ym: '2024-07', code: '150' },
        { ym: '2024-08', code: '180' },
        { ym: '2024-09', code: 'CO' },
      ],
    }),
  ]);
  const findings = scan(file);
  assert.ok(findings.some((finding) => finding.id.endsWith(':dofd-earlier-do-not-touch') && finding.mail === false));
  assert.equal(mailed(findings).length, 0);
  const letter = bureauLetter(file, 'experian', findings, file.tradelines, DATE_LINE, 'please move the delinquency date later');
  assert.match(letter, /NOTHING TO MAIL/);
  assert.match(letter, /will not challenge an earlier first-delinquency date/);
  assert.doesNotMatch(letter, /Why these codes cannot all be true/);
  assertNoIdentity(letter);
  const review = reviewClaim(findings, 'move the first delinquency date later');
  assert.equal(review.mail, false);
});

test('a stale date does not go out alone and does not pad a real break', () => {
  const staleOnly = report([
    tradeline('stale', 'equifax', {
      dateReported: '2026-01-01',
      balance: 200,
      pastDue: 0,
      paymentHistory: [{ ym: '2025-12', code: 'OK' }],
    }),
  ]);
  const staleFindings = scan(staleOnly);
  assert.ok(staleFindings.some((finding) => finding.id.endsWith(':stale-report') && finding.mail === false));
  assert.equal(mailed(staleFindings).length, 0);
  const refused = bureauLetter(staleOnly, 'equifax', staleFindings, staleOnly.tradelines, DATE_LINE);
  assert.match(refused, /NOTHING TO MAIL/);
  assert.match(refused, /too weak to mail by itself/);

  const mixed = report([
    tradeline('mixed', 'equifax', {
      status: '30 days past due',
      dateReported: '2026-01-01',
      dateClosed: null,
      dateOfLastPayment: '2024-06-18',
      dofd: '2024-03-01',
      balance: 400,
      pastDue: 400,
      paymentHistory: [
        { ym: '2024-03', code: '30' },
        { ym: '2024-04', code: '60' },
        { ym: '2024-05', code: '90' },
        { ym: '2024-06', code: '90' },
      ],
    }),
  ]);
  const mixedFindings = scan(mixed);
  assert.ok(mixedFindings.some((finding) => finding.id.endsWith(':stale-report') && !finding.mail));
  assert.ok(mailed(mixedFindings).length > 0);
  const letter = bureauLetter(mixed, 'equifax', mixedFindings, mixed.tradelines, DATE_LINE);
  assert.match(letter, /Why these codes cannot all be true/);
  assert.doesNotMatch(letter, /has not been updated/);
  assert.match(explainBureau(mixed, 'equifax', mixedFindings), /stale reporting date was left out/i);
});

test('too-old debt, double balance, and cross-bureau mismatches are specific', () => {
  const old = report([
    tradeline('cora', 'transunion', {
      creditor: 'Pines Medical',
      accountNumber: 'MED-3308',
      accountType: 'Collection',
      status: 'Collection',
      isCollection: true,
      originalCreditor: 'Pines Medical',
      dateOpened: '2017-06-01',
      dofd: '2017-04-10',
      chargeOffDate: '2017-09-01',
      balance: 420,
      pastDue: 420,
      paymentHistory: [
        { ym: '2017-04', code: '30' },
        { ym: '2017-09', code: 'CO' },
      ],
    }),
  ]);
  const oldFindings = scan(old);
  assert.ok(ids(oldFindings).includes('obsolete'));
  const oldLetter = bureauLetter(old, 'transunion', oldFindings, old.tradelines, DATE_LINE);
  assert.match(oldLetter, /seven years/i);
  assert.match(oldLetter, /Do not update the tradeline and do not re-age it/);
  assertNoIdentity(oldLetter);

  const both = report([
    tradeline('oc', 'equifax', {
      creditor: 'Harbor Appliance',
      accountNumber: '****4419',
      status: 'Charge-off',
      isChargeOff: true,
      dateOpened: '2018-08-01',
      dofd: '2022-05-01',
      chargeOffDate: '2022-11-01',
      dateClosed: '2022-11-01',
      balance: 2600,
      pastDue: 2600,
      paymentHistory: [
        { ym: '2022-04', code: 'OK' },
        { ym: '2022-05', code: '30' },
        { ym: '2022-11', code: 'CO' },
      ],
    }),
    tradeline('col', 'equifax', {
      creditor: 'Sample Recovery',
      accountNumber: 'SC-7788',
      accountType: 'Collection',
      status: 'Collection',
      isCollection: true,
      originalCreditor: 'Harbor Appliance',
      dateOpened: '2025-02-01',
      dofd: '2025-02-01',
      balance: 2600,
      pastDue: 2600,
      paymentHistory: [{ ym: '2025-02', code: 'CO' }],
    }),
  ]);
  const bothFindings = scan(both);
  assert.ok(ids(bothFindings).some((id) => id.startsWith('double-balance')));
  assert.ok(ids(bothFindings).includes('collection-reage'));
  const bothLetter = bureauLetter(both, 'equifax', bothFindings, both.tradelines, DATE_LINE);
  assert.match(bothLetter, /Harbor Appliance/);
  assert.match(bothLetter, /Sample Recovery/);
  assert.match(bothLetter, /Field 21/);
  assert.match(bothLetter, /\$2,600\.00/);
  assert.match(bothLetter, /cannot be owed at once/);
  assert.match(bothLetter, /Opening a collection is not a new date of first delinquency/);

  const split = report([
    tradeline('eq', 'equifax', {
      creditor: 'Metro Fuel Card',
      accountNumber: '****5512',
      status: 'Charge-off',
      isChargeOff: true,
      dateOpened: '2020-01-15',
      dofd: '2023-06-01',
      chargeOffDate: '2023-09-01',
      balance: 6100,
      pastDue: 6100,
      paymentHistory: [
        { ym: '2023-06', code: '30' },
        { ym: '2023-07', code: '60' },
        { ym: '2023-08', code: '90' },
        { ym: '2023-09', code: '180' },
      ],
    }),
    tradeline('ex', 'experian', {
      creditor: 'Metro Fuel Card',
      accountNumber: 'XXXX-5512',
      status: 'Pays as agreed',
      dateOpened: '2020-01-15',
      balance: 400,
      pastDue: 0,
      paymentHistory: [
        { ym: '2026-08', code: 'OK' },
        { ym: '2026-09', code: 'OK' },
        { ym: '2026-10', code: 'OK' },
      ],
    }),
  ]);
  const splitFindings = scan(split);
  assert.ok(ids(splitFindings).some((id) => id.startsWith('cross-')));
  const eqLetter = bureauLetter(split, 'equifax', splitFindings, split.tradelines, DATE_LINE);
  assert.match(eqLetter, /Equifax/);
  assert.match(eqLetter, /Experian/);
  assert.match(eqLetter, /\$6,100\.00/);
  assert.match(eqLetter, /\$400\.00/);
});

test('discharged balance, status versus newest month, missing step, and date reported', () => {
  const discharged = report([
    tradeline('iris', 'equifax', {
      creditor: 'Summit Card',
      accountNumber: '****9904',
      status: 'Included in bankruptcy',
      dischargedBankruptcy: true,
      dofd: '2021-08-01',
      balance: 3200,
      pastDue: 3200,
      remarks: 'Discharged',
      paymentHistory: [
        { ym: '2021-08', code: '30' },
        { ym: '2022-02', code: 'CO' },
      ],
    }),
  ]);
  const dischargedFindings = scan(discharged);
  assert.ok(ids(dischargedFindings).includes('bankruptcy-balance'));
  const dischargedLetter = bureauLetter(discharged, 'equifax', dischargedFindings, discharged.tradelines, DATE_LINE);
  assert.match(dischargedLetter, /Field 38/);
  assert.match(dischargedLetter, /\$3,200\.00/);
  assert.match(dischargedLetter, /not an open balance/);

  const status = report([
    tradeline('status', 'experian', {
      status: 'Charge-off',
      isChargeOff: true,
      dofd: '2026-08-01',
      chargeOffDate: '2026-08-15',
      balance: 900,
      pastDue: 900,
      paymentHistory: [
        { ym: '2026-08', code: 'CO' },
        { ym: '2026-09', code: 'OK' },
      ],
    }),
  ]);
  const statusFindings = scan(status);
  assert.ok(ids(statusFindings).includes('status-vs-newest'));
  const statusLetter = bureauLetter(status, 'experian', statusFindings, status.tradelines, DATE_LINE);
  assert.match(statusLetter, /Field 17A/);
  assert.match(statusLetter, /newest coded month/);
  assert.match(statusLetter, /2026-09/);
  assert.match(statusLetter, /OK/);

  const gap = report([
    tradeline('gap', 'equifax', {
      status: '90 days past due',
      balance: 300,
      pastDue: 300,
      dofd: '2026-08-01',
      paymentHistory: [
        { ym: '2026-08', code: '30' },
        { ym: '2026-09', code: '90' },
      ],
    }),
  ]);
  const gapFindings = scan(gap);
  assert.ok(ids(gapFindings).some((id) => id.startsWith('ladder-')));
  const gapLetter = bureauLetter(gap, 'equifax', gapFindings, gap.tradelines, DATE_LINE);
  assert.match(gapLetter, /Field 18/);
  assert.match(gapLetter, /missing/);
  assert.match(gapLetter, /2026-08/);
  assert.match(gapLetter, /2026-09/);

  const reported = report([
    tradeline('reported', 'transunion', {
      status: '30 days past due',
      dateReported: '2024-05-01',
      dofd: '2024-06-01',
      balance: 100,
      pastDue: 100,
      paymentHistory: [{ ym: '2024-06', code: '30' }],
    }),
  ]);
  const reportedFindings = scan(reported);
  assert.ok(ids(reportedFindings).includes('reported-before-history'));
  const reportedLetter = bureauLetter(reported, 'transunion', reportedFindings, reported.tradelines, DATE_LINE);
  assert.match(reportedLetter, /Field 24/);
  assert.match(reportedLetter, /2024-06/);
  assert.match(reportedLetter, /as-of date/);
});

test('past-due math and impossible dates stay in the letter', () => {
  const math = report([
    tradeline('ben', 'experian', {
      creditor: 'River Bank Auto',
      accountNumber: '****2204',
      status: 'Charge-off',
      isChargeOff: true,
      dofd: '2024-02-01',
      chargeOffDate: '2024-08-01',
      balance: 900,
      pastDue: 2400,
      paymentHistory: [
        { ym: '2024-02', code: '30' },
        { ym: '2024-08', code: 'CO' },
      ],
    }),
  ]);
  const mathLetter = bureauLetter(math, 'experian', scan(math), math.tradelines, DATE_LINE);
  assert.match(mathLetter, /Field 22/);
  assert.match(mathLetter, /\$2,400\.00/);
  assert.match(mathLetter, /cannot be larger than the balance/);

  const dates = report([
    tradeline('gia', 'equifax', {
      status: 'Charge-off',
      isChargeOff: true,
      dateOpened: '2024-05-01',
      dateClosed: '2022-01-01',
      dofd: '2024-05-01',
      chargeOffDate: '2024-07-01',
      balance: 800,
      pastDue: 800,
      paymentHistory: [
        { ym: '2024-05', code: '30' },
        { ym: '2024-06', code: '60' },
        { ym: '2024-07', code: '90' },
      ],
    }),
  ]);
  const dateFindings = scan(dates);
  assert.ok(ids(dateFindings).includes('closed-before-open'));
  const dateLetter = bureauLetter(dates, 'equifax', dateFindings, dates.tradelines, DATE_LINE);
  assert.match(dateLetter, /Field 26/);
  assert.match(dateLetter, /cannot close before it opens/);
});

test('accurate history and identity claims are refused', () => {
  const clean = report([
    tradeline('jules-eq', 'equifax', {
      creditor: 'Northline Credit',
      accountNumber: '****1010',
      dateOfLastPayment: '2026-10-02',
      balance: 450,
      pastDue: 0,
      paymentHistory: [
        { ym: '2026-08', code: 'OK' },
        { ym: '2026-09', code: 'OK' },
        { ym: '2026-10', code: 'OK' },
      ],
    }),
    tradeline('jules-ex', 'experian', {
      creditor: 'Northline Credit',
      accountNumber: '****1010',
      dateOfLastPayment: '2026-10-02',
      balance: 450,
      pastDue: 0,
      paymentHistory: [
        { ym: '2026-08', code: 'OK' },
        { ym: '2026-09', code: 'OK' },
        { ym: '2026-10', code: 'OK' },
      ],
    }),
  ]);
  const findings = scan(clean);
  assert.equal(mailed(findings).length, 0);
  const notMine = bureauLetter(clean, 'equifax', findings, clean.tradelines, DATE_LINE, "this isn't mine");
  assert.match(notMine, /NOTHING TO MAIL/);
  assert.match(notMine, /identity dispute/);
  assertNoIdentity(notMine);
  const deletion = bureauLetter(clean, 'equifax', findings, clean.tradelines, DATE_LINE, 'delete the accurate history');
  assert.match(deletion, /will not dispute true history/);
  assert.equal(reviewClaim(findings, 'this account is not mine').mail, false);
  const follow = movLetter(clean, 'equifax', findings, clean.tradelines, DATE_LINE);
  assert.match(follow, /NOTHING TO MAIL/);
  assert.doesNotMatch(follow, /Who you contacted/);
});
