/**
 * Contradiction scan and report-text parser for Pete's Fix It Up Shop.
 * A point is mailable only when the report disagrees with itself.
 * An earlier first-delinquency date is held back so a letter cannot re-age it.
 */

const CODE_MAP = {
  0: 'OK',
  C: 'OK',
  OK: 'OK',
  E: 'OK',
  CUR: 'OK',
  CURRENT: 'OK',
  1: '30',
  30: '30',
  2: '60',
  60: '60',
  3: '90',
  90: '90',
  4: '120',
  120: '120',
  5: '150',
  150: '150',
  6: '180',
  180: '180',
  9: 'CO',
  CO: 'CO',
  L: 'CO',
  CHARGEOFF: 'CO',
  G: 'CO',
  ND: 'ND',
  U: 'ND',
  X: 'ND',
  '-': 'ND',
  '—': 'ND',
  PP: 'PP',
  RF: 'RF',
  VS: 'VS',
};

const KNOWN_CODES = new Set(['OK', '30', '60', '90', '120', '150', '180', 'CO', 'ND', 'PP', 'RF', 'VS']);

const SEVERITY = {
  OK: 0,
  PP: 0,
  RF: 0,
  30: 1,
  60: 2,
  90: 3,
  120: 4,
  150: 5,
  180: 6,
  CO: 7,
  VS: 7,
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const LAW_DELETE = '15 U.S.C. §1681i(a)(5)(A) — delete or correct an item that is inaccurate, incomplete, or cannot be verified.';
const LAW_ACCURACY = '15 U.S.C. §1681e(b) — a bureau must follow reasonable procedures to assure maximum possible accuracy.';
const LAW_FURNISH = '15 U.S.C. §1681s-2(a)(1)(A) — a furnisher may not report information it knows or should know is inaccurate.';
const LAW_DOFD = '15 U.S.C. §1681s-2(a)(5) — the furnisher must report the date of first delinquency used for the obsolescence clock.';
const LAW_OBSOLETE = '15 U.S.C. §1681c(a)(4) and §1681c(c) — a collection or charge-off may not be reported for more than seven years after the 180-day period that starts on the date of first delinquency.';

export function bureauName(bureau) {
  if (bureau === 'equifax') return 'Equifax';
  if (bureau === 'experian') return 'Experian';
  if (bureau === 'transunion') return 'TransUnion';
  return 'Unknown bureau';
}

export function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text || /^(n\/?a|none|null|unknown|—|-)$/i.test(text)) return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{4})-(\d{2})$/.exec(text);
  if (match) return utcDate(Number(match[1]), Number(match[2]), 1);
  match = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/.exec(text);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return utcDate(year, Number(match[1]), Number(match[2]));
  }
  match = /^(\d{1,2})[/. -](\d{4})$/.exec(text);
  if (match) return utcDate(Number(match[2]), Number(match[1]), 1);
  match = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[1].toLowerCase());
    if (month >= 0) return utcDate(Number(match[3]), month + 1, Number(match[2]));
  }
  return null;
}

function utcDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function toIso(date) {
  if (!date) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function formatLong(date) {
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDate(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return 'not reported';
  return `${formatLong(date)} (${toIso(date)})`;
}

export function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthKeyOf(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return date ? monthKey(date) : null;
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function reportingDeadline(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return null;
  const plus = addDays(date, 180);
  const out = new Date(plus.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + 7);
  return out;
}

export function normalizeCode(code) {
  const key = String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return CODE_MAP[key] ?? key;
}

export function severity(code) {
  return Object.prototype.hasOwnProperty.call(SEVERITY, code) ? SEVERITY[code] : null;
}

export function parseHistory(text) {
  const rows = [];
  const pattern = /(\d{4}-\d{2}|\d{1,2}\/\d{4})\s*[:=]\s*([A-Za-z0-9]+)/g;
  let match;
  while ((match = pattern.exec(String(text ?? '')))) {
    const ym = normalizeMonth(match[1]);
    if (ym) rows.push({ ym, code: normalizeCode(match[2]) });
  }
  return rows;
}

export function normalizeMonth(value) {
  let match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match) {
    const ym = `${match[1]}-${match[2]}`;
    return parseDate(`${ym}-01`) ? ym : null;
  }
  match = /^(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const ym = `${match[2]}-${match[1].padStart(2, '0')}`;
  return parseDate(`${ym}-01`) ? ym : null;
}

export function parseMoney(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(n\/?a|none|null|—|-|not reported)$/i.test(text)) return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  const amount = Number(text.replace(/[$,\s()]/g, ''));
  if (!Number.isFinite(amount)) return null;
  return negative ? -Math.abs(amount) : amount;
}

export function last4(accountNumber) {
  const digits = String(accountNumber ?? '').replace(/\D/g, '');
  return digits.length < 4 ? '' : digits.slice(-4);
}

export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(n\.?a\.?|llc|inc|corp|co|bank|usa|na|fsb|services|service)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function accountKey(tradeline) {
  const tail = last4(tradeline.accountNumber);
  const name = normalizeName(tradeline.creditor);
  if (!tail || !name) return '';
  return `${name}|${tail}`;
}

export function money(amount) {
  if (amount == null || amount === '') return 'not reported';
  const number = typeof amount === 'number' ? amount : parseMoney(amount);
  if (number == null || !Number.isFinite(number)) return 'not reported';
  return number.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function sortedHistory(history) {
  return [...(history ?? [])].filter((row) => /^\d{4}-\d{2}$/.test(row.ym)).sort((a, b) => a.ym.localeCompare(b.ym));
}

export function monthGap(fromYm, toYm) {
  const [fromYear, fromMonth] = fromYm.split('-').map(Number);
  const [toYear, toMonth] = toYm.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

export function uncuredChainStart(history) {
  let start = null;
  for (const row of sortedHistory(history)) {
    const level = severity(row.code);
    if (level == null || row.code === 'ND') continue;
    if (level >= 1) start ??= row.ym;
    else start = null;
  }
  return start;
}

export function newestCoded(history) {
  const rows = sortedHistory(history).filter((row) => severity(row.code) != null && row.code !== 'ND');
  return rows.length ? rows[rows.length - 1] : null;
}

export function firstLadderJump(history) {
  const rows = sortedHistory(history);
  for (let index = 1; index < rows.length; index += 1) {
    const previous = severity(rows[index - 1].code);
    const next = severity(rows[index].code);
    if (previous == null || next == null) continue;
    if (rows[index - 1].code === 'ND' || rows[index].code === 'ND') continue;
    if (next > previous + 1 && monthGap(rows[index - 1].ym, rows[index].ym) === 1) {
      return { from: rows[index - 1], to: rows[index] };
    }
  }
  return null;
}

export function historyContainsMonth(history, ym) {
  const months = sortedHistory(history).map((row) => row.ym);
  if (!months.length) return false;
  return ym >= months[0] && ym <= months[months.length - 1];
}

function statusClass(status) {
  const text = String(status ?? '').toLowerCase();
  if (/charge[\s-]?off|charged off|bad debt|profit and loss/.test(text)) return 'chargeoff';
  if (/collection/.test(text)) return 'collection';
  if (/transfer|sold|purchased by/.test(text)) return 'transferred';
  if (/\b(30|60|90|120|150|180)\b|past due|delinq|late/.test(text)) return 'late';
  if (/pays as agreed|paid as agreed|never late|in good standing|satisfactory|as agreed|current/.test(text)) return 'current';
  if (/paid/.test(text) || /closed/.test(text)) return 'closed';
  return 'unknown';
}

function isNegative(tradeline) {
  const text = `${tradeline.status} ${tradeline.accountType} ${tradeline.remarks}`.toLowerCase();
  if (/charge[\s-]?off|collect|delinq|past due|late|repossess|foreclos|profit and loss|bad debt|bankrupt/.test(text)) return true;
  if (tradeline.isChargeOff || tradeline.isCollection || tradeline.dischargedBankruptcy) return true;
  if ((tradeline.pastDue ?? 0) > 0) return true;
  return tradeline.paymentHistory.some((row) => (severity(row.code) ?? 0) >= 1);
}

function stamp(finding) {
  return { ...finding, mail: finding.mail ?? finding.severity !== 'watch' };
}

function labelOf(tradeline) {
  return `${tradeline.creditor || 'Unnamed account'} (${bureauName(tradeline.bureau)})`;
}

function debtsLinked(left, right) {
  if (!left || !right || left.id === right.id) return false;
  const key = accountKey(left);
  if (key && key === accountKey(right)) return true;
  const original = normalizeName(left.originalCreditor);
  const creditor = normalizeName(right.creditor);
  return Boolean(original && creditor && (original === creditor || creditor.includes(original) || original.includes(creditor)));
}

export function linkedDebt(left, right) {
  return debtsLinked(left, right) || debtsLinked(right, left);
}

export function scan(file) {
  const findings = [];
  const seen = new Set();
  const reportDate = parseDate(file.reportDate);
  const add = (finding) => {
    if (seen.has(finding.id)) return;
    seen.add(finding.id);
    findings.push(stamp(finding));
  };
  for (const tradeline of file.tradelines ?? []) scanTradeline(tradeline, file, reportDate, add);
  for (const inquiry of file.inquiries ?? []) scanInquiry(inquiry, reportDate, add);
  return findings.sort((a, b) => b.pressure - a.pressure || a.severity.localeCompare(b.severity));
}

function scanTradeline(tradeline, file, reportDate, add) {
  const id = tradeline.id;
  const name = labelOf(tradeline);
  const opened = parseDate(tradeline.dateOpened);
  const closed = parseDate(tradeline.dateClosed);
  const lastPayment = parseDate(tradeline.dateOfLastPayment);
  const dofd = parseDate(tradeline.dofd);
  const chargeOff = parseDate(tradeline.chargeOffDate);
  const reported = parseDate(tradeline.dateReported);
  const history = sortedHistory(tradeline.paymentHistory);
  const chainStart = uncuredChainStart(tradeline.paymentHistory);
  const kind = statusClass(tradeline.status);
  const negative = isNegative(tradeline);
  const derogatory = tradeline.isChargeOff || tradeline.isCollection || tradeline.dischargedBankruptcy || kind === 'chargeoff' || kind === 'collection';
  const collection = tradeline.isCollection || kind === 'collection';

  if (negative && !dofd && derogatory) {
    add({
      id: `${id}:dofd-missing`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 5,
      category: 'missing',
      title: 'No date of first delinquency',
      plain: `${name} is negative and does not show the date the seven-year clock starts from.`,
      facts: 'Date of first delinquency is blank on a charged-off, collection, or otherwise delinquent tradeline.',
      law: LAW_DOFD,
      lawPlain: 'Without that date, nobody can tell whether the item is too old to report. An incomplete derogatory item is unverifiable.',
      demand: 'Delete the tradeline unless the furnisher reports the original date of first delinquency and it matches the payment grid.',
    });
  } else if (negative && !dofd) {
    add({
      id: `${id}:dofd-missing`,
      tradelineId: id,
      inquiryId: null,
      severity: 'watch',
      pressure: 1,
      category: 'missing',
      title: 'No first-delinquency date on a late account',
      plain: `${name} is late and does not print a first-delinquency date. That date is required once an account is charged off or placed for collection. It is often absent on a plain late.`,
      facts: 'Date of first delinquency is blank. The tradeline is not a charge-off or a collection.',
      law: LAW_DOFD,
      lawPlain: 'Do not mail a letter that only says this date is missing. Pair it with a real contradiction, or wait until the account is a charge-off or a collection.',
      demand: 'Do not mail this point by itself.',
      mail: false,
    });
  }

  if (dofd && chainStart) {
    const dofdMonth = monthKey(dofd);
    if (dofdMonth > chainStart) {
      add({
        id: `${id}:dofd-reage`,
        tradelineId: id,
        inquiryId: null,
        severity: 'delete',
        pressure: 5,
        category: 'reage',
        title: 'First-delinquency date is later than the payment grid',
        plain: `${name} says the first delinquency was ${formatLong(dofd)}, but its own payment grid already shows a delinquency that was never brought current in ${chainStart}.`,
        facts: `Reported DOFD month ${dofdMonth}. Uncured delinquency chain on the grid starts ${chainStart}.`,
        law: `${LAW_DOFD} Re-aging a delinquency to a later date keeps a negative item on the report longer than §1681c allows.`,
        lawPlain: "The furnisher's two dates describe two different debts-in-default. They cannot both be the start of this same chain. That is the inconsistency that makes a 'verified' response fail.",
        demand: 'Delete the tradeline. Do not accept a later date of first delinquency than the grid\'s uncured chain.',
      });
    } else if (dofdMonth < chainStart && historyContainsMonth(tradeline.paymentHistory, dofdMonth)) {
      const cell = history.find((row) => row.ym === dofdMonth);
      if (cell && (severity(cell.code) ?? 1) === 0) {
        add({
          id: `${id}:dofd-earlier-do-not-touch`,
          tradelineId: id,
          inquiryId: null,
          severity: 'watch',
          pressure: 1,
          category: 'dates',
          title: 'Do not dispute this earlier delinquency date',
          plain: `${name} shows a first-delinquency month (${dofdMonth}) that is earlier than the visible late chain, and that month is coded current. Leaving it alone makes the item age off sooner.`,
          facts: `Reported DOFD ${dofdMonth} is coded ${cell.code}. Visible uncured chain starts ${chainStart}.`,
          law: LAW_DOFD,
          lawPlain: 'Disputing an earlier start date can cause a furnisher to move it later. That restarts the harm. This shop will not put it in a letter.',
          demand: 'Do not mail a dispute about this date.',
          mail: false,
        });
      }
    }
  }

  if (dofd && chargeOff && monthKey(dofd) > monthKey(chargeOff)) {
    add({
      id: `${id}:dofd-after-chargeoff`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 5,
      category: 'dates',
      title: 'Delinquency date is after the charge-off',
      plain: `${name} lists a first delinquency of ${formatLong(dofd)} after a charge-off on ${formatLong(chargeOff)}. The clock cannot start after the account was already charged off.`,
      facts: `DOFD ${formatLong(dofd)} is later than charge-off ${formatLong(chargeOff)}.`,
      law: `${LAW_DOFD} ${LAW_OBSOLETE}`,
      lawPlain: 'Charge-off happens after a delinquency, not before it. The file contradicts itself.',
      demand: 'Delete the tradeline unless one date is corrected and both dates then match the payment grid.',
    });
  }

  if (dofd && opened && !collection && dofd.getTime() < addDays(opened, -31).getTime()) {
    add({
      id: `${id}:dofd-before-open`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 4,
      category: 'dates',
      title: 'Delinquency date is before the account opened',
      plain: `${name} was not open until ${formatLong(opened)}, but the first delinquency is ${formatLong(dofd)}.`,
      facts: `Opened ${formatLong(opened)}. DOFD ${formatLong(dofd)}.`,
      law: `${LAW_ACCURACY} ${LAW_DOFD}`,
      lawPlain: 'An account cannot become delinquent before it exists. If this is a transferred debt, the original open date has to be on the file.',
      demand: "Delete or replace both dates with the original account's open date and original first delinquency.",
    });
  }

  if (opened && closed && closed.getTime() < opened.getTime()) {
    add({
      id: `${id}:closed-before-open`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 5,
      category: 'dates',
      title: 'Closed before it opened',
      plain: `${name} shows a close date of ${formatLong(closed)} and an open date of ${formatLong(opened)}.`,
      facts: 'Date closed is earlier than date opened.',
      law: LAW_ACCURACY,
      lawPlain: 'Those two fields cannot describe one real account.',
      demand: 'Delete the tradeline.',
    });
  }

  if (lastPayment && closed && lastPayment.getTime() > closed.getTime()) {
    add({
      id: `${id}:paid-after-close`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 4,
      category: 'dates',
      title: 'Payment date is after the account closed',
      plain: `${name} shows a last payment on ${formatLong(lastPayment)}, which is after the close date of ${formatLong(closed)}.`,
      facts: `Last payment ${formatLong(lastPayment)}. Closed ${formatLong(closed)}.`,
      law: `${LAW_ACCURACY} ${LAW_FURNISH}`,
      lawPlain: 'A payment cannot post to an account after the date the furnisher says it ceased to exist, unless they are describing a different event and have mislabeled the date.',
      demand: 'Delete the tradeline or correct the two dates so the payment is on or before the close, consistent with the grid.',
    });
  }

  if (lastPayment && opened && !collection && lastPayment.getTime() < opened.getTime()) {
    add({
      id: `${id}:paid-before-open`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 4,
      category: 'dates',
      title: 'Payment date is before the account opened',
      plain: `${name} shows a payment on ${formatLong(lastPayment)} before the open date of ${formatLong(opened)}.`,
      facts: `Last payment ${formatLong(lastPayment)}. Opened ${formatLong(opened)}.`,
      law: LAW_ACCURACY,
      lawPlain: 'The payment date and the open date are not the same account history.',
      demand: 'Delete the tradeline or correct the dates to a sequence the payment grid also shows.',
    });
  }

  if (lastPayment && reported && lastPayment.getTime() > reported.getTime()) {
    add({
      id: `${id}:paid-after-reported`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 4,
      category: 'dates',
      title: 'Last payment is after the date reported',
      plain: `${name} shows a last payment on ${formatLong(lastPayment)}, after the date reported of ${formatLong(reported)}.`,
      facts: `Last payment ${formatLong(lastPayment)}. Date reported ${formatLong(reported)}.`,
      law: `${LAW_ACCURACY} ${LAW_FURNISH}`,
      lawPlain: 'Date of last payment and date of account information cannot describe a payment that happened after the record claims to be current.',
      demand: 'Delete the tradeline or correct the two dates so the payment is on or before the date reported, and the payment grid agrees.',
    });
  }

  if (lastPayment) {
    const payMonth = monthKey(lastPayment);
    const cell = history.find((row) => row.ym === payMonth);
    if (cell) {
      const level = severity(cell.code);
      if (cell.code === 'ND' || cell.code === '') {
        add({
          id: `${id}:last-pay-nd`,
          tradelineId: id,
          inquiryId: null,
          severity: 'correct',
          pressure: 3,
          category: 'dates',
          title: 'Payment month is blank on the grid',
          plain: `${name} gives ${formatLong(lastPayment)} as the last payment, but that month is coded no-data.`,
          facts: `${payMonth} is coded ${cell.code || 'blank'}.`,
          law: LAW_ACCURACY,
          lawPlain: 'A reported payment has to appear in the payment history for that month.',
          demand: 'Correct the grid or delete the last-payment date. If both cannot be made true, delete the tradeline.',
        });
      } else if (level != null && level >= 1) {
        add({
          id: `${id}:last-pay-late`,
          tradelineId: id,
          inquiryId: null,
          severity: 'delete',
          pressure: 5,
          category: 'dates',
          title: 'Payment date lands on a late or charge-off month',
          plain: `${name} says a payment was made ${formatLong(lastPayment)}, but ${payMonth} is coded ${cell.code}, not a payment received.`,
          facts: `Date of last payment ${formatLong(lastPayment)} falls in ${payMonth}, coded ${cell.code}.`,
          law: `${LAW_ACCURACY} ${LAW_FURNISH}`,
          lawPlain: 'This is the date-versus-grid break. The furnisher cannot verify both fields. Section 611 requires the bureau to delete what it cannot verify.',
          demand: 'Delete the tradeline unless the furnisher produces one payment history in which that month shows the payment they claim.',
        });
      }
    } else if (historyContainsMonth(tradeline.paymentHistory, payMonth)) {
      add({
        id: `${id}:last-pay-missing-cell`,
        tradelineId: id,
        inquiryId: null,
        severity: 'correct',
        pressure: 3,
        category: 'dates',
        title: 'Payment month is missing from the grid',
        plain: `${name} reports a last payment in ${payMonth}, inside the history window, with no cell for that month.`,
        facts: `Last payment ${formatLong(lastPayment)} has no matching history month.`,
        law: LAW_ACCURACY,
        lawPlain: 'A missing month in the middle of a reported history is an incomplete file.',
        demand: 'Complete the month or delete the tradeline.',
      });
    }
  }

  if (opened && !collection) {
    const openMonth = monthKey(opened);
    const early = history.filter((row) => row.ym < openMonth && row.code && row.code !== 'ND');
    if (early.length > 0) {
      add({
        id: `${id}:history-before-open`,
        tradelineId: id,
        inquiryId: null,
        severity: 'delete',
        pressure: 4,
        category: 'dates',
        title: 'Payment history starts before the open date',
        plain: `${name} shows activity in ${early[0].ym} even though it opened ${formatLong(opened)}.`,
        facts: `History months before open: ${early.map((row) => row.ym).join(', ')}.`,
        law: LAW_ACCURACY,
        lawPlain: "History from before the account existed is not this account's history.",
        demand: 'Delete the tradeline or replace the open date and the grid with one consistent history.',
      });
    }
  }

  const jump = firstLadderJump(tradeline.paymentHistory);
  if (jump) {
    add({
      id: `${id}:ladder-${jump.to.ym}`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 4,
      category: 'dates',
      title: 'Delinquency skips a month on the grid',
      plain: `${name} jumps from ${jump.from.code} in ${jump.from.ym} to ${jump.to.code} in ${jump.to.ym}. A past-due account ages one bucket at a time.`,
      facts: `${jump.from.ym}:${jump.from.code} then ${jump.to.ym}:${jump.to.code}.`,
      law: `${LAW_ACCURACY} Industry Metro 2 payment history must age 30 days at a time.`,
      lawPlain: 'Skipping from current to 90, or 30 to 120, means the history was edited or mis-coded. A furnisher that cannot show the missing months has an incomplete file.',
      demand: 'Delete the tradeline unless the missing severity months are produced and they still match the other dates.',
    });
  }

  for (const row of history) {
    if (row.code && !KNOWN_CODES.has(row.code)) {
      add({
        id: `${id}:unknown-code`,
        tradelineId: id,
        inquiryId: null,
        severity: 'watch',
        pressure: 1,
        category: 'dates',
        title: 'Payment code is not a standard code',
        plain: `${name} uses “${row.code}” in ${row.ym}. Confirm the code before you treat it as a late.`,
        facts: `Unrecognized history code ${row.code}.`,
        law: LAW_ACCURACY,
        lawPlain: 'Do not build a dispute on a code this shop cannot read. Fix the code in Intake if you know it.',
        demand: 'No letter until the code is translated.',
        mail: false,
      });
      break;
    }
  }

  if (chargeOff) {
    const later = history.filter((row) => {
      const level = severity(row.code);
      return row.ym > monthKey(chargeOff) && level != null && level >= 1 && level < 7 && row.code !== 'CO';
    });
    if (later.length > 0) {
      add({
        id: `${id}:lates-after-chargeoff`,
        tradelineId: id,
        inquiryId: null,
        severity: 'delete',
        pressure: 4,
        category: 'dates',
        title: 'New lates appear after charge-off',
        plain: `${name} was charged off ${formatLong(chargeOff)} and then shows ${later[0].code} in ${later[0].ym}. The history keeps aging after the charge-off.`,
        facts: `Charge-off ${formatLong(chargeOff)}. Later delinquency codes: ${later.map((row) => `${row.ym}:${row.code}`).join(', ')}.`,
        law: `${LAW_FURNISH} ${LAW_DOFD}`,
        lawPlain: 'Once an account is charged off, later 30/60/90 codes describe a new delinquency cycle. That is how accounts get re-aged.',
        demand: 'Delete the post-charge-off delinquency codes. If the furnisher cannot, delete the tradeline.',
      });
    }
  }

  const newest = newestCoded(tradeline.paymentHistory);
  if (kind === 'current' && newest && (severity(newest.code) ?? 0) >= 1) {
    add({
      id: `${id}:current-but-late`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 5,
      category: 'status',
      title: 'Status says current while the grid is late',
      plain: `${name} is reported “${tradeline.status}”, but the newest coded month ${newest.ym} is ${newest.code}.`,
      facts: `Status “${tradeline.status}”. Latest history ${newest.ym}:${newest.code}.`,
      law: `${LAW_ACCURACY} ${LAW_FURNISH}`,
      lawPlain: 'A current status and a fresh delinquency cannot both be accurate. This is one of the cleanest deletion records because the contradiction is inside a single tradeline.',
      demand: 'Delete the tradeline unless status and the latest history month are made the same, and every other date still agrees.',
    });
  }

  if (newest && newest.code === 'OK' && (kind === 'chargeoff' || kind === 'collection' || kind === 'late')) {
    add({
      id: `${id}:status-vs-newest`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 5,
      category: 'status',
      title: 'Status does not match the newest coded month',
      plain: `${name} says “${tradeline.status}”, but the newest coded month ${newest.ym} is OK.`,
      facts: `Status “${tradeline.status}”. Newest history ${newest.ym}:${newest.code}.`,
      law: `${LAW_ACCURACY} ${LAW_FURNISH}`,
      lawPlain: 'Account status and the newest payment-history code have to describe the same condition. Current and a charge-off or collection status cannot both be the latest month.',
      demand: 'Delete the tradeline unless the status and the newest coded month are made the same, and the other dates still agree.',
    });
  }

  if (kind === 'current' && (tradeline.pastDue ?? 0) > 0) {
    add({
      id: `${id}:current-but-pastdue`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 4,
      category: 'status',
      title: 'Status says current while an amount is past due',
      plain: `${name} is “${tradeline.status}” and also ${money(tradeline.pastDue)} past due.`,
      facts: `Status “${tradeline.status}”. Past due ${money(tradeline.pastDue)}.`,
      law: LAW_FURNISH,
      lawPlain: 'Current and past-due are opposites. The bureau has to pick the one the furnisher can prove, or delete the item.',
      demand: 'Delete or correct so a current account does not carry a past-due amount.',
    });
  }

  if (tradeline.balance != null && tradeline.pastDue != null && tradeline.pastDue > tradeline.balance + 0.009) {
    add({
      id: `${id}:pastdue-over-balance`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 5,
      category: 'math',
      title: 'Past due is larger than the balance',
      plain: `${name} is ${money(tradeline.pastDue)} past due on a ${money(tradeline.balance)} balance. The amount past due cannot exceed what is owed.`,
      facts: `Past due ${money(tradeline.pastDue)}. Balance ${money(tradeline.balance)}.`,
      law: `${LAW_ACCURACY} ${LAW_DELETE}`,
      lawPlain: 'This is arithmetic, not a matter of opinion. A file that fails arithmetic is not verifiable as accurate.',
      demand: 'Delete the tradeline or correct both numbers so the past-due amount is less than or equal to the balance.',
    });
  }

  if (tradeline.balance != null && tradeline.balance > 0) {
    const cap = Math.max(tradeline.highBalance ?? 0, tradeline.creditLimit ?? 0);
    if (cap > 0 && tradeline.balance > cap + Math.max(50, cap * 0.1)) {
      add({
        id: `${id}:balance-over-cap`,
        tradelineId: id,
        inquiryId: null,
        severity: 'correct',
        pressure: 3,
        category: 'math',
        title: 'Balance is above the limit and the high credit',
        plain: `${name} shows a balance of ${money(tradeline.balance)} over a high credit of ${money(tradeline.highBalance)} and a limit of ${money(tradeline.creditLimit)}.`,
        facts: 'Balance exceeds the greater of high credit and credit limit by more than 10 percent and more than $50.',
        law: LAW_ACCURACY,
        lawPlain: 'Fees can push a balance over a limit. A gap this wide still has to be explained by the furnisher or corrected.',
        demand: 'Correct the balance, the high credit, or the limit so they can exist together. Delete the tradeline if they cannot.',
      });
    }
  }

  if ((tradeline.balance ?? 0) === 0 && (tradeline.pastDue ?? 0) > 0) {
    add({
      id: `${id}:zero-but-pastdue`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 4,
      category: 'math',
      title: 'Zero balance with money still past due',
      plain: `${name} shows a zero balance and ${money(tradeline.pastDue)} still past due.`,
      facts: 'Balance is 0 while past due is greater than 0.',
      law: LAW_FURNISH,
      lawPlain: 'Nothing remains due on a zero balance.',
      demand: 'Delete the past-due amount or delete the tradeline.',
    });
  }

  if (tradeline.dischargedBankruptcy && ((tradeline.balance ?? 0) > 0 || (tradeline.pastDue ?? 0) > 0)) {
    add({
      id: `${id}:bankruptcy-balance`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 5,
      category: 'status',
      title: 'Discharged debt still shows a balance',
      plain: `${name} is marked as included in a bankruptcy discharge and still shows ${money(tradeline.balance)} owed and ${money(tradeline.pastDue)} past due.`,
      facts: 'Discharged bankruptcy flag with a positive balance or past-due amount.',
      law: `${LAW_FURNISH} A discharged debt is not an open obligation of the consumer.`,
      lawPlain: 'The balance after discharge has to be zero, with a remark that it was included in bankruptcy. Reporting it as still owed is inaccurate.',
      demand: 'Correct the balance and past due to zero and show the bankruptcy remark, or delete the tradeline.',
    });
  }

  if (negative && !String(tradeline.accountNumber ?? '').replace(/[^0-9A-Za-z]/g, '')) {
    add({
      id: `${id}:no-account-number`,
      tradelineId: id,
      inquiryId: null,
      severity: 'correct',
      pressure: 3,
      category: 'missing',
      title: 'No account number on a negative item',
      plain: `${name} is negative and has no account number, so you cannot tie it to a contract.`,
      facts: 'Account number is blank.',
      law: LAW_DELETE,
      lawPlain: 'An item that cannot be identified cannot be verified as yours.',
      demand: 'Delete the tradeline unless the furnisher identifies the account and every date on it still agrees.',
    });
  }

  if (dofd && reportDate && negative) {
    const deadline = reportingDeadline(dofd);
    if (reportDate.getTime() > deadline.getTime()) {
      add({
        id: `${id}:obsolete`,
        tradelineId: id,
        inquiryId: null,
        severity: 'delete',
        pressure: 5,
        category: 'obsolete',
        title: 'Too old to report',
        plain: `${name} had a first delinquency on ${formatLong(dofd)}. The reporting window closed ${formatLong(deadline)}. This report is dated ${formatLong(reportDate)}.`,
        facts: `DOFD ${formatLong(dofd)}. Statutory deadline ${formatLong(deadline)}. Report date ${formatLong(reportDate)}.`,
        law: LAW_OBSOLETE,
        lawPlain: "This one is not a judgment call. If the first-delinquency date is right, the bureau has to remove the negative item. They do not get to 'verify' their way past the time limit.",
        demand: 'Delete the tradeline under the obsolescence rule. Do not update it. Do not re-age it.',
      });
    }
  }

  if (reportDate) {
    const staleMonths = history.filter((row) => {
      const monthDate = parseDate(`${row.ym}-01`);
      if (!monthDate || (severity(row.code) ?? 0) < 1) return false;
      return reportDate.getTime() > reportingDeadline(monthDate).getTime();
    });
    if (staleMonths.length > 0) {
      add({
        id: `${id}:obsolete-months`,
        tradelineId: id,
        inquiryId: null,
        severity: 'delete',
        pressure: 4,
        category: 'obsolete',
        title: 'Old lates are still printed on the grid',
        plain: `${name} still shows delinquency codes from ${staleMonths[0].ym}, which is past the seven-year-plus-180-day window.`,
        facts: `Obsolete history months: ${staleMonths.map((row) => `${row.ym}:${row.code}`).join(', ')}.`,
        law: '15 U.S.C. §1681c(a)(5) and §1681c(c) — adverse information that is too old must come off, including stale delinquency codes.',
        lawPlain: 'Even if some newer history could stay, these specific months cannot.',
        demand: 'Delete the obsolete months. If stripping them breaks the rest of the history, delete the tradeline.',
      });
    }
  }

  if (reported && reportDate && !closed && kind !== 'chargeoff' && kind !== 'collection' && reportDate.getTime() - reported.getTime() > 10368000000) {
    add({
      id: `${id}:stale-report`,
      tradelineId: id,
      inquiryId: null,
      severity: 'watch',
      pressure: 2,
      category: 'dates',
      title: 'Open account has not been updated in months',
      plain: `${name} was last reported ${formatLong(reported)} on a report dated ${formatLong(reportDate)}. Do not lead with this. Use it only as support if a real contradiction is also present.`,
      facts: 'Date reported is more than 120 days before the report date on an open, non-collection account.',
      law: "Metro 2 expects open accounts to be updated on the furnisher's regular reporting cycle. Staleness alone is a weak dispute.",
      lawPlain: 'A stale date is a reason to ask for an update, not a standalone removal theory. Pairing it with a real contradiction is fair. Sending it alone gets a frivolous-dispute stamp.',
      demand: 'Do not send a letter that contains only this point.',
      mail: false,
    });
  }

  if (reported && newest && newest.code !== 'ND' && newest.ym > monthKey(reported)) {
    add({
      id: `${id}:reported-before-history`,
      tradelineId: id,
      inquiryId: null,
      severity: 'delete',
      pressure: 4,
      category: 'dates',
      title: 'Payment grid is later than the date reported',
      plain: `${name} was reported as of ${formatLong(reported)}, but the grid already codes ${newest.ym} as ${newest.code}.`,
      facts: `Date reported ${formatLong(reported)}. Newest history ${newest.ym}:${newest.code}.`,
      law: `${LAW_ACCURACY} ${LAW_FURNISH}`,
      lawPlain: 'The date of account information is the as-of date of the Metro 2 record. The payment history profile cannot contain a later month.',
      demand: 'Delete the tradeline or correct the date reported and the grid so the newest month is not after the as-of date.',
    });
  }

  if (collection && dofd && opened && monthKey(dofd) >= monthKey(opened)) {
    const earlier = (file.tradelines ?? []).find((other) => {
      if (other.id === tradeline.id) return false;
      if (!debtsLinked(tradeline, other) && normalizeName(tradeline.originalCreditor) !== normalizeName(other.creditor)) return false;
      const otherChain = uncuredChainStart(other.paymentHistory);
      const otherDofd = parseDate(other.dofd);
      const otherStart = otherChain ?? (otherDofd ? monthKey(otherDofd) : null);
      return Boolean(otherStart && otherStart < monthKey(dofd));
    });
    if (earlier) {
      add({
        id: `${id}:collection-reage`,
        tradelineId: id,
        inquiryId: null,
        severity: 'delete',
        pressure: 5,
        category: 'reage',
        title: 'Collection uses its own open date as the delinquency date',
        plain: `${name} starts the seven-year clock at ${formatLong(dofd)}, on or after the collection opened. ${earlier.creditor} already shows an earlier delinquency.`,
        facts: `Collection DOFD ${monthKey(dofd)} and open ${monthKey(opened)}. Earlier account ${earlier.creditor} shows ${uncuredChainStart(earlier.paymentHistory) ?? earlier.dofd}.`,
        law: `${LAW_DOFD} ${LAW_OBSOLETE} A collector must keep the original creditor's date of first delinquency. Opening a collection is not a new delinquency.`,
        lawPlain: 'This is re-aging. The law dates the debt from the original missed payment that was never cured, not from the day a collector bought it.',
        demand: "Delete the collection. If anything is reported, the date of first delinquency must be the original creditor's date, and the whole chain must match.",
      });
    }
  }

  for (const other of file.tradelines ?? []) {
    if (other.id <= tradeline.id) continue;
    const key = accountKey(tradeline);
    if (!key || key !== accountKey(other)) continue;
    if (tradeline.bureau === other.bureau) {
      for (const side of [tradeline, other]) {
        add({
          id: `${side.id}:duplicate-${tradeline.id}-${other.id}`,
          tradelineId: side.id,
          inquiryId: null,
          severity: 'delete',
          pressure: 4,
          category: 'duplicate',
          title: 'Same account is listed twice at one bureau',
          plain: `${side.creditor} (${bureauName(side.bureau)}) shares an account ending ${last4(tradeline.accountNumber)} with a second tradeline at that bureau.`,
          facts: `Duplicate pair ${tradeline.creditor} and ${other.creditor}.`,
          law: LAW_ACCURACY,
          lawPlain: 'One debt, one tradeline. A double entry double-counts the harm.',
          demand: 'Delete the duplicate. Keep at most one tradeline, and only if its dates agree.',
        });
      }
    }
    const clashes = [];
    if (tradeline.balance != null && other.balance != null) {
      const gap = Math.abs(tradeline.balance - other.balance);
      const scale = Math.max(Math.abs(tradeline.balance), Math.abs(other.balance), 1);
      if (gap > Math.max(50, scale * 0.05)) clashes.push(`balance ${money(tradeline.balance)} versus ${money(other.balance)}`);
    }
    const dofdMonth = dofd ? monthKey(dofd) : null;
    const otherDofd = parseDate(other.dofd);
    if (dofdMonth && otherDofd && dofdMonth !== monthKey(otherDofd)) clashes.push(`first delinquency ${dofdMonth} versus ${monthKey(otherDofd)}`);
    if (opened && parseDate(other.dateOpened) && monthKey(opened) !== monthKey(parseDate(other.dateOpened))) {
      clashes.push(`opened ${monthKey(opened)} versus ${monthKey(parseDate(other.dateOpened))}`);
    }
    if (lastPayment && parseDate(other.dateOfLastPayment) && monthKey(lastPayment) !== monthKey(parseDate(other.dateOfLastPayment))) {
      clashes.push(`last payment ${monthKey(lastPayment)} versus ${monthKey(parseDate(other.dateOfLastPayment))}`);
    }
    if (kind !== 'unknown' && statusClass(other.status) !== 'unknown' && kind !== statusClass(other.status)) {
      clashes.push(`status “${tradeline.status}” versus “${other.status}”`);
    }
    if (clashes.length > 0) {
      const facts = `Account ending ${last4(tradeline.accountNumber)}. ${clashes.join('; ')}.`;
      for (const side of [tradeline, other]) {
        const opposite = side.id === tradeline.id ? other : tradeline;
        add({
          id: `${side.id}:cross-${tradeline.id}-${other.id}`,
          tradelineId: side.id,
          inquiryId: null,
          severity: 'delete',
          pressure: 5,
          category: 'cross',
          title: 'Bureaus disagree on the same account',
          plain: `${bureauName(side.bureau)} and ${bureauName(opposite.bureau)} do not match on ${side.creditor}: ${clashes.join('; ')}.`,
          facts,
          law: `${LAW_ACCURACY} ${LAW_DELETE}`,
          lawPlain: "The same furnisher file cannot be two different balances or two different first-delinquency dates. At least one bureau is inaccurate. Each bureau must delete the copy it cannot reconcile to a single set of fields.",
          demand: "Delete this bureau's tradeline unless it is corrected to one set of facts that also matches the payment grid. Quote the other bureau's figures so a 'verified' response cannot ignore the conflict.",
        });
      }
    }
  }

  if (collection && (tradeline.balance ?? 0) > 0) {
    const original = (file.tradelines ?? []).find((other) => {
      if (other.id === tradeline.id || other.isCollection || statusClass(other.status) === 'collection' || (other.balance ?? 0) <= 0) return false;
      return debtsLinked(tradeline, other) || normalizeName(tradeline.originalCreditor) === normalizeName(other.creditor);
    });
    if (original) {
      for (const side of [tradeline, original]) {
        add({
          id: `${side.id}:double-balance-${tradeline.id}-${original.id}`,
          tradelineId: side.id,
          inquiryId: null,
          severity: 'delete',
          pressure: 5,
          category: 'duplicate',
          title: 'Original creditor and collector both show a balance',
          plain: `${tradeline.creditor} shows ${money(tradeline.balance)} and ${original.creditor} still shows ${money(original.balance)} for the same debt.`,
          facts: `Collection balance ${money(tradeline.balance)}. Original balance ${money(original.balance)}.`,
          law: `${LAW_ACCURACY} A sold debt is reported by the new owner, and the seller's balance goes to zero. A debt that was not sold is not also a collection balance.`,
          lawPlain: 'Two companies cannot both be owed the same dollar. One balance is inaccurate. Until a single owner is proven, neither figure is verifiable.',
          demand: 'Delete the collection, and delete or zero the original creditor balance, unless one owner is identified and the other balance is zero.',
        });
      }
    }
  }
}

function scanInquiry(inquiry, reportDate, add) {
  if (inquiry.kind === 'soft' || !reportDate) return;
  const date = parseDate(inquiry.date);
  if (!date) return;
  const months = (reportDate.getUTCFullYear() - date.getUTCFullYear()) * 12 + (reportDate.getUTCMonth() - date.getUTCMonth());
  if (months <= 24) return;
  add({
    id: `${inquiry.id}:inquiry-old`,
    tradelineId: null,
    inquiryId: inquiry.id,
    severity: 'correct',
    pressure: 3,
    category: 'inquiry',
    title: "Inquiry is older than the bureaus' two-year practice",
    plain: `${inquiry.name} is still listed from ${formatLong(date)}. The nationwide bureaus drop hard inquiries after 24 months.`,
    facts: `Inquiry date ${formatLong(date)}. Report date ${formatLong(reportDate)}. About ${months} months old.`,
    law: "The FCRA's seven-year rule is for adverse account history, not a special two-year inquiry statute. The two-year drop is the bureaus' own published reporting practice, enforced as an accuracy complaint under 15 U.S.C. §1681e(b) when they do not follow it.",
    lawPlain: "Ask them to remove it because their own rule says it is gone. Do not cite a statute section that does not say 'two years.'",
    demand: "Delete the inquiry as obsolete under the bureau's 24-month inquiry policy.",
  });
}

const FIELD_MAP = {
  bureau: 'bureau',
  creditor: 'creditor',
  'account name': 'creditor',
  furnisher: 'creditor',
  account: 'accountNumber',
  'account number': 'accountNumber',
  'acct no': 'accountNumber',
  acct: 'accountNumber',
  type: 'accountType',
  'account type': 'accountType',
  status: 'status',
  'account status': 'status',
  'payment status': 'status',
  opened: 'dateOpened',
  'date opened': 'dateOpened',
  'open date': 'dateOpened',
  closed: 'dateClosed',
  'date closed': 'dateClosed',
  'close date': 'dateClosed',
  reported: 'dateReported',
  'date reported': 'dateReported',
  'last payment': 'dateOfLastPayment',
  'date of last payment': 'dateOfLastPayment',
  'last payment date': 'dateOfLastPayment',
  dofd: 'dofd',
  'date of first delinquency': 'dofd',
  'first delinquency': 'dofd',
  'charge off': 'chargeOffDate',
  'charge-off': 'chargeOffDate',
  'charge off date': 'chargeOffDate',
  'date charged off': 'chargeOffDate',
  balance: 'balance',
  'past due': 'pastDue',
  'amount past due': 'pastDue',
  high: 'highBalance',
  'high balance': 'highBalance',
  'high credit': 'highBalance',
  limit: 'creditLimit',
  'credit limit': 'creditLimit',
  monthly: 'monthlyPayment',
  'monthly payment': 'monthlyPayment',
  'scheduled payment': 'monthlyPayment',
  'charge off amount': 'chargeOffAmount',
  'original creditor': 'originalCreditor',
  collection: 'collection',
  bankruptcy: 'bankruptcy',
  'included in bankruptcy': 'bankruptcy',
  remarks: 'remarks',
  comments: 'remarks',
  comment: 'remarks',
  history: 'history',
  'payment history': 'history',
};

let idSerial = 0;

function nextId(prefix) {
  idSerial += 1;
  return `${prefix}-${idSerial}-${Math.random().toString(36).slice(2, 8)}`;
}

export function detectBureau(text) {
  const sample = String(text ?? '').toLowerCase();
  if (sample.includes('equifax')) return 'equifax';
  if (sample.includes('experian')) return 'experian';
  if (sample.includes('trans')) return 'transunion';
  return 'unknown';
}

function yesFlag(value) {
  return /^(y|yes|true|1|included|discharged)$/i.test(String(value ?? '').trim());
}

function blockToTradeline(block, fallbackBureau) {
  const creditor = String(block.creditor ?? '').trim();
  const accountNumber = String(block.accountNumber ?? '').trim();
  if (!creditor && !accountNumber) return null;
  const bureau = block.bureau ? detectBureau(block.bureau) : fallbackBureau;
  return {
    id: nextId('tl'),
    bureau,
    creditor: creditor || 'Unnamed account',
    accountNumber,
    accountType: String(block.accountType ?? '').trim(),
    status: String(block.status ?? '').trim(),
    dateOpened: toIso(parseDate(block.dateOpened)),
    dateClosed: toIso(parseDate(block.dateClosed)),
    dateReported: toIso(parseDate(block.dateReported)),
    dateOfLastPayment: toIso(parseDate(block.dateOfLastPayment)),
    dofd: toIso(parseDate(block.dofd)),
    chargeOffDate: toIso(parseDate(block.chargeOffDate)),
    balance: block.balance == null ? null : parseMoney(block.balance),
    pastDue: block.pastDue == null ? null : parseMoney(block.pastDue),
    highBalance: block.highBalance == null ? null : parseMoney(block.highBalance),
    creditLimit: block.creditLimit == null ? null : parseMoney(block.creditLimit),
    monthlyPayment: block.monthlyPayment == null ? null : parseMoney(block.monthlyPayment),
    chargeOffAmount: block.chargeOffAmount == null ? null : parseMoney(block.chargeOffAmount),
    paymentHistory: parseHistory(block.history ?? ''),
    remarks: String(block.remarks ?? '').trim(),
    originalCreditor: String(block.originalCreditor ?? '').trim(),
    isCollection: yesFlag(block.collection) || /collection/i.test(`${block.accountType ?? ''} ${block.status ?? ''} ${block.creditor ?? ''}`),
    isChargeOff: /charge[\s-]?off|charged off|bad debt|profit and loss/i.test(`${block.status ?? ''} ${block.accountType ?? ''} ${block.remarks ?? ''}`),
    dischargedBankruptcy: yesFlag(block.bankruptcy) || /discharged/i.test(block.remarks ?? ''),
  };
}

function labeledBlocks(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let block = null;
  let field = null;
  let inInquiry = false;
  const push = () => {
    if (block && Object.keys(block).length > 0) blocks.push(block);
    block = null;
    field = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^INQUIRY\s*:/i.test(line)) {
      push();
      inInquiry = true;
      continue;
    }
    if (inInquiry) {
      if (/^CREDITOR\s*:/i.test(line) || /^(---|===|###)$/.test(line)) inInquiry = false;
      else continue;
    }
    if (!line) continue;
    if (/^(---|===|###)$/.test(line)) {
      push();
      continue;
    }
    const labeled = /^([A-Za-z][A-Za-z0-9 /#-]{1,40})\s*:\s*(.*)$/.exec(line);
    if (labeled) {
      const key = FIELD_MAP[labeled[1].toLowerCase().replace(/\s+/g, ' ').trim()];
      if (key) {
        if (key === 'creditor' && block?.creditor) push();
        block ??= {};
        block[key] = block[key] ? `${block[key]} ${labeled[2].trim()}`.trim() : labeled[2].trim();
        field = key;
        continue;
      }
    }
    if (block && field && (field === 'history' || field === 'remarks')) block[field] = `${block[field]} ${line}`.trim();
  }
  push();
  return blocks;
}

function inquiryBlocks(text, fallbackBureau) {
  return String(text ?? '')
    .split(/\n(?=INQUIRY\s*:)/i)
    .filter((part) => /^INQUIRY\s*:/i.test(part.trim()))
    .map((part) => {
      const name = /^INQUIRY\s*:\s*(.+)$/im.exec(part)?.[1]?.trim() ?? 'Inquiry';
      const bureau = /BUREAU\s*:\s*(.+)$/im.exec(part)?.[1];
      const date = /DATE\s*:\s*(.+)$/im.exec(part)?.[1];
      const kindText = /KIND\s*:\s*(.+)$/im.exec(part)?.[1]?.toLowerCase() ?? '';
      const kind = kindText.includes('soft') ? 'soft' : kindText.includes('hard') ? 'hard' : 'unknown';
      return {
        id: nextId('inq'),
        bureau: bureau ? detectBureau(bureau) : fallbackBureau,
        name,
        date: toIso(parseDate(date)),
        kind,
      };
    });
}

function looseAccount(chunk, heading) {
  const block = {};
  const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
  const headingLines = heading.split('\n').map((line) => line.trim()).filter(Boolean);
  const guessed = [...headingLines].reverse().find((line) => !/:$/.test(line) && !/^account\b/i.test(line));
  if (guessed) block.creditor = guessed.replace(/[:*]+$/g, '').trim();
  const take = (pattern, key) => {
    const match = new RegExp(`${pattern}\\s*[:#]?\\s*([^\\n]+)`, 'i').exec(chunk);
    if (match) block[key] = match[1].trim();
  };
  take('Account\\s*(?:Number|#|No\\.?)', 'accountNumber');
  take('Account\\s*Type', 'accountType');
  take('Account\\s*Status|Payment\\s*Status', 'status');
  take('Date\\s*Opened|Open(?:ed)?\\s*Date', 'dateOpened');
  take('Date\\s*Closed|Close(?:d)?\\s*Date', 'dateClosed');
  take('Date\\s*Reported|Reported', 'dateReported');
  take('Date\\s*of\\s*Last\\s*Payment|Last\\s*Payment(?:\\s*Date)?', 'dateOfLastPayment');
  take('Date\\s*of\\s*First\\s*Delinquency|DOFD|First\\s*Delinquency', 'dofd');
  take('(?:Date\\s*)?(?:Charged?\\s*Off|Charge-Off)', 'chargeOffDate');
  take('Balance(?:\\s*Amount)?', 'balance');
  take('(?:Amount\\s*)?Past\\s*Due', 'pastDue');
  take('High\\s*(?:Balance|Credit)', 'highBalance');
  take('Credit\\s*Limit', 'creditLimit');
  take('Monthly\\s*Payment|Scheduled\\s*Payment', 'monthlyPayment');
  take('Original\\s*Creditor', 'originalCreditor');
  take('Comments?|Remarks?', 'remarks');
  const history = [...chunk.matchAll(/(\d{4}-\d{2}|\d{1,2}\/\d{4})\s*[:=]\s*([A-Za-z0-9]+)/g)].map((match) => `${match[1]}:${match[2]}`);
  if (history.length) block.history = history.join(', ');
  if (lines[0] && !block.creditor && !/^account\b/i.test(lines[0])) block.creditor = lines[0];
  return block;
}

export function parseReport(text) {
  const warnings = [];
  const source = String(text ?? '');
  const reportDate = toIso(parseDate(/REPORT\s*DATE\s*:\s*(.+)$/im.exec(source)?.[1] ?? ''));
  const consumerName = /CONSUMER\s*:\s*(.+)$/im.exec(source)?.[1]?.trim() ?? '';
  const headBureau = detectBureau(source.slice(0, 500));
  const inquiries = inquiryBlocks(source, headBureau === 'unknown' ? 'unknown' : headBureau);
  let tradelines = labeledBlocks(source).map((block) => blockToTradeline(block, headBureau)).filter(Boolean);
  if (tradelines.length === 0) {
    const chunks = source.split(/(?=(?:^|\n)\s*Account\s*(?:Number|#|No\.?)\s*[:#])/i);
    if (chunks.length > 1) {
      tradelines = chunks.slice(1).map((chunk, index) => {
        const heading = chunks[index] ?? '';
        const bureau = detectBureau(`${heading}\n${chunk}`);
        return blockToTradeline(looseAccount(chunk, heading), bureau === 'unknown' ? headBureau : bureau);
      }).filter(Boolean);
      if (tradelines.length === 0) warnings.push('Saw account-number lines but could not read the fields around them.');
    } else {
      warnings.push('No CREDITOR: blocks and no account-number lines. Use the form, or label each account with CREDITOR: and the other fields.');
    }
  }
  const thin = tradelines.filter((tradeline) => !tradeline.paymentHistory.length && !tradeline.dofd && !tradeline.dateOfLastPayment);
  if (tradelines.length > 0 && thin.length === tradelines.length) {
    warnings.push('Accounts were found, but no payment grid or delinquency date was read. Add HISTORY: lines or fill those dates before you trust the scan.');
  }
  for (const tradeline of tradelines) {
    if (tradeline.accountNumber && !last4(tradeline.accountNumber)) {
      warnings.push(`${tradeline.creditor} has no last four digits. Cross-bureau matching needs them.`);
    }
  }
  return { consumerName, reportDate, tradelines, inquiries, warnings };
}
