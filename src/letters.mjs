/**
 * Metro 2 rebuttal drafts. Letters argue only contradictions the scan will mail.
 * They do not claim an account is not the consumer's, and they do not ask to
 * move an earlier delinquency date later.
 */

import {
  accountKey,
  bureauName,
  firstLadderJump,
  formatDate,
  linkedDebt,
  money,
  monthKeyOf,
  newestCoded,
  reportingDeadline,
  sortedHistory,
  uncuredChainStart,
} from './engine.mjs';

const BUREAU_ADDRESS = {
  equifax: `Equifax Information Services LLC
P.O. Box 740256
Atlanta, GA 30374`,
  experian: `Experian
P.O. Box 4500
Allen, TX 75013`,
  transunion: `TransUnion Consumer Solutions
P.O. Box 2000
Chester, PA 19016`,
  unknown: '[Bureau dispute address printed on your report]',
};

const IDENTITY_CLAIM = /not mine|isn.?t mine|is not mine|does not belong|do not owe|don't owe|never (had|opened)|identity theft/i;
const DELETE_ACCURATE_CLAIM = /delete (the )?(true|accurate)|remove accurate history|dispute true history/i;
const REAGE_CLAIM = /move (the )?(first|dofd|delinquency).{0,24}later|later (dofd|delinquency)|re-?age/i;

export function mailFindings(findings, tradelineId) {
  return findings.filter((finding) => finding.mail && finding.tradelineId === tradelineId);
}

export function reviewClaim(findings, claim = '') {
  const mail = findings.filter((finding) => finding.mail);
  const held = findings.filter((finding) => !finding.mail);
  const reasons = [];
  if (IDENTITY_CLAIM.test(claim) && mail.length === 0) {
    reasons.push('This shop will not write an identity dispute about an account the file does not contradict.');
  }
  if (DELETE_ACCURATE_CLAIM.test(claim) && mail.length === 0) {
    reasons.push('This shop will not dispute true history just to seek deletion.');
  }
  if (REAGE_CLAIM.test(claim) || (mail.length === 0 && held.some((finding) => finding.id.includes('dofd-earlier')))) {
    reasons.push('This shop will not challenge an earlier first-delinquency date. Asking a furnisher to move that date can start the seven-year clock over.');
  }
  if (mail.length === 0 && held.some((finding) => finding.id.includes('stale-report'))) {
    reasons.push('An open account that has not been updated lately is too weak to mail by itself.');
  }
  if (mail.length === 0 && held.some((finding) => finding.id.includes('unknown-code'))) {
    reasons.push('A payment code on the grid could not be read. No letter until that code is filled in.');
  }
  if (mail.length === 0 && reasons.length === 0) {
    reasons.push('Nothing on this file is a contradiction this shop will stand behind.');
  }
  const suppressed = [];
  if (mail.length > 0 && held.some((finding) => finding.id.includes('dofd-earlier'))) {
    suppressed.push('An earlier delinquency date was left out of the letter so it cannot restart the clock.');
  }
  if (mail.length > 0 && held.some((finding) => finding.id.includes('stale-report'))) {
    suppressed.push('A stale reporting date was left out. It does not go out on its own, and it is not padding this letter.');
  }
  if (IDENTITY_CLAIM.test(claim)) {
    suppressed.push('An identity claim was not added. The letter only argues fields that contradict each other.');
  }
  return { mail: mail.length > 0, reasons, suppressed };
}

function heading(file, dateLine) {
  return [
    dateLine,
    '',
    file.consumerName || '[Your full name]',
    '[Your current mailing address]',
    '[City, State ZIP]',
    '[Last four of SSN, optional]',
    '',
    'Re: Dispute of Metro 2 fields that cannot all be true',
    `Report date used: ${formatDate(file.reportDate)}`,
    '',
  ].join('\n');
}

function refusalLetter(file, dateLine, findings, claim) {
  const review = reviewClaim(findings, claim);
  return [
    heading(file, dateLine),
    'NOTHING TO MAIL',
    '',
    'This is not a dispute letter. Do not send it.',
    '',
    ...review.reasons.map((reason) => `- ${reason}`),
    '',
    'Accurate history stays. This shop does not invent a dispute, and it does not ask to move a delinquency date later.',
  ].join('\n');
}

function accountTitle(tradeline) {
  const tail = String(tradeline.accountNumber ?? '').replace(/\D/g, '').slice(-4);
  return `${tradeline.creditor || 'Unnamed account'}${tail ? `, account ending ${tail}` : ' (no account number on the report)'}`;
}

function historyLine(tradeline) {
  const rows = sortedHistory(tradeline.paymentHistory);
  if (!rows.length) return 'not reported';
  return rows.map((row) => `${row.ym}:${row.code}`).join(', ');
}

function fieldBlock(tradeline) {
  const lines = [
    `Account Status (Field 17A): ${tradeline.status || 'not reported'}`,
    `Payment History Profile (Field 18): ${historyLine(tradeline)}`,
    `Date Opened (Field 10): ${formatDate(tradeline.dateOpened)}`,
    `Credit Limit (Field 11): ${money(tradeline.creditLimit)}`,
    `Highest Credit (Field 12): ${money(tradeline.highBalance)}`,
    `Current Balance (Field 21): ${money(tradeline.balance)}`,
    `Amount Past Due (Field 22): ${money(tradeline.pastDue)}`,
    `Original Charge-off Amount (Field 23): ${money(tradeline.chargeOffAmount)}`,
    `Date of Account Information (Field 24): ${formatDate(tradeline.dateReported)}`,
    `FCRA Date of First Delinquency (Field 25): ${formatDate(tradeline.dofd)}`,
    `Date Closed (Field 26): ${formatDate(tradeline.dateClosed)}`,
    `Date of Last Payment (Field 27): ${formatDate(tradeline.dateOfLastPayment)}`,
  ];
  if (tradeline.dischargedBankruptcy || /bankrupt/i.test(`${tradeline.status} ${tradeline.remarks}`)) {
    lines.push(`Consumer Information Indicator (Field 38): bankruptcy or discharge is noted (${tradeline.status || tradeline.remarks || 'flagged on the report'})`);
  }
  if (tradeline.isCollection || /collection/i.test(`${tradeline.accountType} ${tradeline.status}`)) {
    lines.push(`Original Creditor Name (K1 segment): ${tradeline.originalCreditor || 'not reported'}`);
  }
  return lines.join('\n');
}

function hasId(findings, part) {
  return findings.some((finding) => finding.id.includes(part));
}

function crossPartner(tradeline, tradelines) {
  const key = accountKey(tradeline);
  if (!key) return null;
  return tradelines.find((other) => other.id !== tradeline.id && other.bureau !== tradeline.bureau && accountKey(other) === key) ?? null;
}

function balancePartner(tradeline, tradelines) {
  return tradelines.find((other) => other.id !== tradeline.id && linkedDebt(tradeline, other) && (tradeline.isCollection || other.isCollection || /collection/i.test(`${tradeline.status} ${other.status} ${tradeline.accountType} ${other.accountType}`))) ?? null;
}

function whyParagraphs(tradelines, findings, file, allTradelines) {
  const paragraphs = [];
  const primary = tradelines[0];
  const newest = newestCoded(primary.paymentHistory);
  const chain = uncuredChainStart(primary.paymentHistory);
  const jump = firstLadderJump(primary.paymentHistory);
  const payMonth = monthKeyOf(primary.dateOfLastPayment);

  if (hasId(findings, 'last-pay') || hasId(findings, 'paid-after-reported') || hasId(findings, 'reported-before-history')) {
    const bits = [];
    if (hasId(findings, 'last-pay-late') || hasId(findings, 'last-pay-nd') || hasId(findings, 'last-pay-missing-cell')) {
      const cell = sortedHistory(primary.paymentHistory).find((row) => row.ym === payMonth);
      bits.push(`Field 27, Date of Last Payment, is ${formatDate(primary.dateOfLastPayment)}${payMonth ? `, which falls in ${payMonth}` : ''}. Field 18, the Payment History Profile, ${cell ? `codes that same month ${cell.code}` : `has no cell for ${payMonth}`}. A last-payment date means a payment was received. A ${cell ? cell.code : 'missing'} code for that month does not. Both cannot be true in one Base Segment.`);
    }
    if (hasId(findings, 'paid-after-reported')) {
      bits.push(`Field 27 is also after Field 24, Date of Account Information (${formatDate(primary.dateReported)}). A payment cannot post after the date the record claims to be current.`);
    }
    if (hasId(findings, 'reported-before-history') && newest) {
      bits.push(`Field 24 says the record is current as of ${formatDate(primary.dateReported)}, but Field 18 already contains ${newest.ym} coded ${newest.code}. The profile cannot include a month later than its own as-of date.`);
    }
    if (bits.length) paragraphs.push(bits.join(' '));
  }

  if (hasId(findings, 'dofd-reage') || hasId(findings, 'dofd-after-chargeoff') || hasId(findings, 'collection-reage') || hasId(findings, 'obsolete') || hasId(findings, 'dofd-before-open') || hasId(findings, 'dofd-missing')) {
    const bits = [];
    if (hasId(findings, 'dofd-reage') && chain) {
      bits.push(`Field 25, the FCRA date of first delinquency, is ${formatDate(primary.dofd)}. Field 18 already shows an uncured delinquency chain that starts in ${chain}. Field 25 cannot be later than that chain. The two dates describe two different starts for the same debt, and the later one would keep the negative item on the report past 15 U.S.C. §1681c. I am not asking you to move an earlier date later.`);
    }
    if (hasId(findings, 'dofd-after-chargeoff')) {
      bits.push(`Field 25 (${formatDate(primary.dofd)}) is also after the charge-off date on the report (${formatDate(primary.chargeOffDate)}). A charge-off follows a delinquency. It does not come first.`);
    }
    if (hasId(findings, 'collection-reage')) {
      const earlier = allTradelines.find((other) => linkedDebt(primary, other) && other.id !== primary.id);
      bits.push(`This collection's Field 25 is ${formatDate(primary.dofd)}, on or after the date the collection itself opened (${formatDate(primary.dateOpened)}). ${earlier ? `${earlier.creditor} already shows an earlier delinquency (${uncuredChainStart(earlier.paymentHistory) || formatDate(earlier.dofd)}). ` : ''}Opening a collection is not a new date of first delinquency. The K1 original creditor's date is the one the clock uses.`);
    }
    if (hasId(findings, 'obsolete') || hasId(findings, 'obsolete-months')) {
      const deadline = reportingDeadline(primary.dofd);
      bits.push(`Counted from Field 25, seven years plus 180 days ${deadline ? `ended ${formatDate(deadline)}` : 'has passed'}. This report is dated ${formatDate(file.reportDate)}. Field 18 still prints delinquency codes that are too old. Delete them. Do not update the tradeline and do not re-age it.`);
    }
    if (hasId(findings, 'dofd-before-open')) {
      bits.push(`Field 25 (${formatDate(primary.dofd)}) is before Field 10, Date Opened (${formatDate(primary.dateOpened)}). The account cannot go delinquent before it exists.`);
    }
    if (hasId(findings, 'dofd-missing') && findings.some((finding) => finding.mail && finding.id.includes('dofd-missing'))) {
      bits.push('Field 25 is blank on a charged-off, collection, or otherwise derogatory tradeline. Without that date the seven-year clock cannot be checked against Field 18, so the record is incomplete.');
    }
    if (bits.length) paragraphs.push(bits.join(' '));
  }

  if (hasId(findings, 'ladder-') || hasId(findings, 'last-pay-missing-cell') || hasId(findings, 'history-before-open') || hasId(findings, 'lates-after-chargeoff')) {
    const bits = [];
    if (jump && hasId(findings, 'ladder-')) {
      bits.push(`Field 18 jumps from ${jump.from.code} in ${jump.from.ym} to ${jump.to.code} in ${jump.to.ym}. A Metro 2 payment history ages one 30-day bucket per month. The month that would connect those codes is missing, so the profile is not a complete record.`);
    }
    if (hasId(findings, 'history-before-open')) {
      bits.push(`Field 18 also shows months before Field 10, Date Opened (${formatDate(primary.dateOpened)}). History from before the account existed is not this account's history.`);
    }
    if (hasId(findings, 'lates-after-chargeoff')) {
      bits.push(`After the charge-off date ${formatDate(primary.chargeOffDate)}, Field 18 keeps aging into new 30/60/90 codes. Those later codes are a new delinquency cycle, which is how a charged-off account gets re-aged.`);
    }
    if (bits.length) paragraphs.push(bits.join(' '));
  }

  if (hasId(findings, 'current-but-late') || hasId(findings, 'status-vs-newest') || hasId(findings, 'current-but-pastdue')) {
    const bits = [];
    if (newest && (hasId(findings, 'current-but-late') || hasId(findings, 'status-vs-newest'))) {
      bits.push(`Field 17A, Account Status, says “${primary.status || 'not reported'}”. The newest coded month in Field 18 is ${newest.ym} coded ${newest.code}. Account Status has to describe the same condition as that newest Payment History Profile character. Field 24, Date of Account Information, is ${formatDate(primary.dateReported)}, so this is the record the furnisher says is current. Those codes cannot all be true at once.`);
    }
    if (hasId(findings, 'current-but-pastdue')) {
      bits.push(`Field 17A is still a current status while Field 22, Amount Past Due, is ${money(primary.pastDue)}. Current and past due are opposites.`);
    }
    if (bits.length) paragraphs.push(bits.join(' '));
  }

  if (hasId(findings, 'pastdue-over-balance') || hasId(findings, 'zero-but-pastdue') || hasId(findings, 'balance-over-cap')) {
    paragraphs.push(`Field 21, Current Balance, is ${money(primary.balance)}. Field 22, Amount Past Due, is ${money(primary.pastDue)}. ${hasId(findings, 'pastdue-over-balance') ? 'The amount past due cannot be larger than the balance. ' : ''}${hasId(findings, 'zero-but-pastdue') ? 'A zero balance cannot still be past due. ' : ''}${hasId(findings, 'balance-over-cap') ? `The balance is also above both the credit limit (${money(primary.creditLimit)}) and the high credit (${money(primary.highBalance)}) by more than a fee would explain. ` : ''}The dollars in this Base Segment do not describe one possible debt.`);
  }

  if (hasId(findings, 'bankruptcy-balance')) {
    paragraphs.push(`Field 38, the Consumer Information Indicator, marks this tradeline as included in a bankruptcy discharge (${primary.status || primary.remarks || 'discharge noted'}). Field 21 is still ${money(primary.balance)} and Field 22 is still ${money(primary.pastDue)}. A discharged debt is not an open balance. After discharge those amounts are zero.`);
  }

  if (hasId(findings, 'double-balance')) {
    const partner = tradelines[1] || balancePartner(primary, allTradelines);
    const collection = [primary, partner].find((item) => item && (item.isCollection || /collection/i.test(`${item.accountType} ${item.status}`)));
    const original = [primary, partner].find((item) => item && item !== collection);
    if (collection && original) {
      paragraphs.push(`${original.creditor} reports Field 21 Current Balance ${money(original.balance)} and ${collection.creditor} reports Field 21 Current Balance ${money(collection.balance)} for the same debt${collection.originalCreditor ? ` (K1 original creditor: ${collection.originalCreditor})` : ''}. A sold account's seller balance goes to zero. A debt that was not sold is not also a collection balance. Both Field 21 amounts cannot be owed at once.`);
    }
  }

  if (hasId(findings, 'cross-')) {
    const partner = crossPartner(primary, allTradelines);
    if (partner) {
      paragraphs.push(`${bureauName(primary.bureau)} and ${bureauName(partner.bureau)} published the same account ending ${accountKey(primary).split('|')[1]} with Metro 2 values that cannot both be the file. ${bureauName(primary.bureau)} Field 17A is “${primary.status || 'not reported'}” and Field 21 is ${money(primary.balance)}; Field 25 is ${formatDate(primary.dofd)}. ${bureauName(partner.bureau)} Field 17A is “${partner.status || 'not reported'}” and Field 21 is ${money(partner.balance)}; Field 25 is ${formatDate(partner.dofd)}. One Base Segment cannot be two balances or two first-delinquency dates. Quote both copies so a one-word “verified” cannot ignore the other bureau.`);
    }
  }

  if (hasId(findings, 'duplicate-')) {
    paragraphs.push(`The same account ending ${String(primary.accountNumber ?? '').replace(/\D/g, '').slice(-4)} is listed twice at ${bureauName(primary.bureau)}. One debt is one tradeline. A second Field 21 balance double-counts the same debt.`);
  }

  if (hasId(findings, 'closed-before-open') || hasId(findings, 'paid-after-close') || hasId(findings, 'paid-before-open')) {
    const bits = [];
    if (hasId(findings, 'closed-before-open')) bits.push(`Field 26, Date Closed, is ${formatDate(primary.dateClosed)} and Field 10, Date Opened, is ${formatDate(primary.dateOpened)}. The account cannot close before it opens.`);
    if (hasId(findings, 'paid-after-close')) bits.push(`Field 27, Date of Last Payment, is ${formatDate(primary.dateOfLastPayment)}, after Field 26, Date Closed (${formatDate(primary.dateClosed)}).`);
    if (hasId(findings, 'paid-before-open')) bits.push(`Field 27 is ${formatDate(primary.dateOfLastPayment)}, before Field 10, Date Opened (${formatDate(primary.dateOpened)}).`);
    paragraphs.push(bits.join(' '));
  }

  if (hasId(findings, 'no-account-number')) {
    paragraphs.push('The tradeline is derogatory and Field 7, the consumer account number, is blank. An item that cannot be tied to an account cannot be verified as accurate.');
  }

  const covered = paragraphs.length > 0;
  if (!covered) {
    for (const finding of findings.filter((item) => item.mail)) {
      paragraphs.push(`${finding.title}. ${finding.facts} ${finding.demand}`);
    }
  }
  return paragraphs;
}

function demandFor(findings) {
  const mailed = findings.filter((finding) => finding.mail);
  const hasDelete = mailed.some((finding) => finding.severity === 'delete');
  if (hasDelete) {
    return 'Delete this tradeline unless you can produce one Metro 2 Base Segment in which every field quoted above is true at the same time, including the Payment History Profile. If you correct a field instead, send the corrected value next to the old one. Do not answer with the single word “verified.”';
  }
  return 'Correct the fields so they can exist together. This is a correction demand. It is weaker as a pure deletion case, and I am not asking you to delete accurate history.';
}

function oneBrokenSentence(tradeline, findings, allTradelines) {
  if (hasId(findings, 'last-pay-late')) {
    const month = monthKeyOf(tradeline.dateOfLastPayment);
    const cell = sortedHistory(tradeline.paymentHistory).find((row) => row.ym === month);
    return `Date of Last Payment falls in ${month}, which the Payment History Profile codes ${cell?.code || 'late'}.`;
  }
  if (hasId(findings, 'dofd-reage') || hasId(findings, 'collection-reage')) {
    return `Date of First Delinquency is later than the delinquency already showing on the Payment History Profile.`;
  }
  if (hasId(findings, 'obsolete')) return 'The date of first delinquency is past the seven-year reporting window and the item is still on the file.';
  if (hasId(findings, 'double-balance')) {
    const partner = balancePartner(tradeline, allTradelines);
    return `Current Balance is ${money(tradeline.balance)} while ${partner ? partner.creditor : 'the other furnisher'} also shows a balance for the same debt.`;
  }
  if (hasId(findings, 'cross-')) {
    const partner = crossPartner(tradeline, allTradelines);
    return `${bureauName(tradeline.bureau)} and ${partner ? bureauName(partner.bureau) : 'the other bureau'} do not match on balance or status for this account.`;
  }
  if (hasId(findings, 'bankruptcy-balance')) return 'A bankruptcy discharge is noted and a balance is still reported as owed.';
  if (hasId(findings, 'status-vs-newest') || hasId(findings, 'current-but-late')) {
    const newest = newestCoded(tradeline.paymentHistory);
    return `Account Status says “${tradeline.status}” while the newest coded month is ${newest ? `${newest.ym}:${newest.code}` : 'a different condition'}.`;
  }
  if (hasId(findings, 'ladder-')) return 'The Payment History Profile skips a delinquency step, so a month is missing.';
  if (hasId(findings, 'reported-before-history')) return 'The Payment History Profile contains a month later than the date the account was reported.';
  if (hasId(findings, 'pastdue-over-balance')) return `Amount Past Due (${money(tradeline.pastDue)}) is larger than Current Balance (${money(tradeline.balance)}).`;
  const first = findings.find((finding) => finding.mail);
  return first ? first.plain : 'The same contradictory fields are still on the file.';
}

function groupTradelines(selected, findings, allTradelines) {
  const used = new Set();
  const groups = [];
  for (const tradeline of selected) {
    if (used.has(tradeline.id)) continue;
    const mine = mailFindings(findings, tradeline.id);
    if (mine.length === 0) continue;
    const partner = balancePartner(tradeline, selected);
    const partnerMail = partner ? mailFindings(findings, partner.id) : [];
    const shareBalance = partner && partnerMail.some((finding) => finding.id.includes('double-balance')) && mine.some((finding) => finding.id.includes('double-balance'));
    if (shareBalance) {
      used.add(tradeline.id);
      used.add(partner.id);
      groups.push({ tradelines: [tradeline, partner], findings: [...mine, ...partnerMail] });
    } else {
      used.add(tradeline.id);
      groups.push({ tradelines: [tradeline], findings: mine });
    }
  }
  return groups;
}

function tradelineSection(group, file, allTradelines) {
  const blocks = group.tradelines.map((tradeline) => [`${accountTitle(tradeline)}`, `Bureau copy: ${bureauName(tradeline.bureau)}`, fieldBlock(tradeline)].join('\n'));
  const why = whyParagraphs(group.tradelines, group.findings, file, allTradelines);
  return [
    ...blocks,
    '',
    'Why these codes cannot all be true:',
    ...why.map((paragraph, index) => `${index + 1}. ${paragraph}`),
    '',
    `Demand: ${demandFor(group.findings)}`,
  ].join('\n');
}

function firstLetterClose() {
  return [
    '',
    'I am not disputing accurate information. I am disputing the items above because those Metro 2 fields contradict each other, a required date is missing, or the item is too old to report. I am not making an identity dispute.',
    '',
    'Please finish the investigation in the 30 days required by 15 U.S.C. §1681i(a)(1) (45 days only if I send more information during that window). If an item is inaccurate, incomplete, or cannot be verified, delete it or correct it under §1681i(a)(5)(A). Do not meet a contradiction with the single word “verified.”',
    '',
    'With the results, send the method of verification required by §1681i(a)(6)(B)(iii) and §1681i(a)(7): who you contacted, what you sent them, and what they sent back. If you say verified and the same break is still on the new report, the next letter will ask for that procedure. It will not repeat this one.',
    '',
    'Sincerely,',
    '',
    '[Your signature]',
    '[Your printed name]',
  ].join('\n');
}

function sectionsFor(file, findings, predicate) {
  const selected = (file.tradelines ?? []).filter(predicate);
  return groupTradelines(selected, findings, file.tradelines ?? []).map((group) => tradelineSection(group, file, file.tradelines ?? []));
}

export function bureauLetter(file, bureau, findings, tradelines, dateLine, claim = '') {
  const list = tradelines ?? file.tradelines ?? [];
  const relevant = findings.filter((finding) => list.some((tradeline) => tradeline.id === finding.tradelineId && tradeline.bureau === bureau));
  const review = reviewClaim(relevant, claim);
  if (!review.mail) return refusalLetter(file, dateLine, relevant, claim);
  const sections = sectionsFor({ ...file, tradelines: list }, findings, (tradeline) => tradeline.bureau === bureau && mailFindings(findings, tradeline.id).length > 0);
  return [
    heading(file, dateLine),
    BUREAU_ADDRESS[bureau] || BUREAU_ADDRESS.unknown,
    '',
    `To whom it may concern at ${bureauName(bureau)}:`,
    '',
    'Under 15 U.S.C. §1681i, I dispute the tradelines below. This is not a statement that an account was “late.” It is a Metro 2 coding rebuttal: the fields printed on the file cannot all be true in one Base Segment at the same time.',
    '',
    'Confirm the dispute address on your own report before you mail this. An old post office box misses the 30-day clock.',
    '',
    sections.join('\n\n'),
    firstLetterClose(),
  ].join('\n');
}

export function furnisherLetter(file, furnisher, findings, tradelines, dateLine, claim = '') {
  const list = tradelines ?? file.tradelines ?? [];
  const relevant = findings.filter((finding) => list.some((tradeline) => tradeline.id === finding.tradelineId && tradeline.creditor === furnisher));
  const review = reviewClaim(relevant, claim);
  if (!review.mail) return refusalLetter(file, dateLine, relevant, claim);
  const sections = sectionsFor({ ...file, tradelines: list }, findings, (tradeline) => tradeline.creditor === furnisher && mailFindings(findings, tradeline.id).length > 0);
  return [
    heading(file, dateLine),
    furnisher,
    '[Furnisher dispute address printed on the report — not the payment address]',
    '',
    `To whom it may concern at ${furnisher}:`,
    '',
    'This is a direct dispute under 15 U.S.C. §1681s-2(a)(8) and 12 C.F.R. §1022.43, and a notice of the inaccuracies below. You must not furnish information you know or have reasonable cause to believe is inaccurate. 15 U.S.C. §1681s-2(a)(1)(A).',
    '',
    'The problem is not a generic status code. The Metro 2 fields below cannot all be true at once. Investigate those fields. Report the results to each bureau that is publishing them. If you cannot produce one Base Segment in which every date, status, and dollar amount below is true together, stop reporting the tradeline.',
    '',
    sections.join('\n\n'),
    firstLetterClose(),
  ].join('\n');
}

export function movLetter(file, bureau, findings, tradelines, dateLine, claim = '') {
  const list = tradelines ?? file.tradelines ?? [];
  const selected = list.filter((tradeline) => (bureau === 'unknown' || tradeline.bureau === bureau) && mailFindings(findings, tradeline.id).length > 0);
  const relevant = findings.filter((finding) => selected.some((tradeline) => tradeline.id === finding.tradelineId));
  const review = reviewClaim(relevant, claim);
  if (!review.mail) return refusalLetter(file, dateLine, relevant, claim);
  const lines = selected.map((tradeline) => `- ${accountTitle(tradeline)} (${bureauName(tradeline.bureau)}). Still broken: ${oneBrokenSentence(tradeline, mailFindings(findings, tradeline.id), list)}`);
  return [
    heading(file, dateLine),
    BUREAU_ADDRESS[bureau] || BUREAU_ADDRESS.unknown,
    '',
    'SECOND LETTER — send this only after they say “verified” and the same break is still on the new report.',
    '',
    `To whom it may concern at ${bureauName(bureau)}:`,
    '',
    'You already finished a reinvestigation of the items below and reported them verified. This letter does not repeat that dispute. I am not sending the same coding argument again.',
    '',
    'The same Metro 2 fields still contradict each other:',
    '',
    lines.join('\n'),
    '',
    'I request the description of the procedure used to determine the accuracy and completeness of these items, as required by 15 U.S.C. §1681i(a)(6)(B)(iii) and §1681i(a)(7). For each tradeline above, send:',
    '',
    '1. Who you contacted: the business name and address of every furnisher, and the telephone number if reasonably available.',
    '2. What you sent them: the specific Metro 2 fields that were in dispute (Account Status, Payment History Profile, Date of First Delinquency, Date of Last Payment, Date of Account Information, Current Balance, Amount Past Due, and the Consumer Information Indicator where that field is the break). A generic code with no field values is not a description of the procedure.',
    '3. What they sent back: the value returned for each of those fields, and how those returned values can all be true at the same time.',
    '',
    'Under §1681i(a)(5)(A), information that cannot be verified must be deleted. If you cannot produce that procedure, delete the tradeline. If you modify it, send an updated report that shows every field named here.',
    '',
    'If the same inaccurate fields are furnished again after this notice, I reserve my rights under 15 U.S.C. §§1681n and 1681o. I will also send this record to the Consumer Financial Protection Bureau.',
    '',
    'Sincerely,',
    '',
    '[Your signature]',
    '[Your printed name]',
  ].join('\n');
}

export function cfpbSheet(file, findings, tradelines) {
  const list = tradelines ?? file.tradelines ?? [];
  const mailed = findings.filter((finding) => finding.mail);
  const lines = [
    'CFPB complaint facts — paste into a complaint only after a bureau says verified and the contradiction remains.',
    'Portal (when you are online): consumerfinance.gov/complaint',
    '',
    `Consumer: ${file.consumerName || '[name]'}`,
    `Report date: ${formatDate(file.reportDate)}`,
    '',
    'What happened:',
  ];
  for (const finding of mailed) {
    const tradeline = list.find((item) => item.id === finding.tradelineId);
    lines.push(`- ${tradeline ? accountTitle(tradeline) : finding.title}: ${oneBrokenSentence(tradeline || { paymentHistory: [], status: '' }, [finding], list)}`);
  }
  lines.push('');
  lines.push('What I already did: mailed a specific Metro 2 dispute quoting the fields that cannot all be true, then asked for the method of verification (who was contacted, what was sent, and what came back). I am not asking to delete accurate history.');
  lines.push('What I want: deletion of each item that is still self-contradictory, and the method of verification.');
  return lines.join('\n');
}

function themeBits(findings) {
  const bits = [];
  if (findings.some((finding) => /last-pay|paid-after-reported|reported-before-history/.test(finding.id))) {
    bits.push('The payment grid does not match the last-payment date or the date the account was reported.');
  }
  if (findings.some((finding) => /dofd-reage|dofd-after|collection-reage|obsolete|dofd-before|dofd-missing/.test(finding.id))) {
    bits.push('The date of first delinquency does not fit the late history, or the item is already past seven years plus 180 days.');
  }
  if (findings.some((finding) => finding.id.includes('double-balance'))) {
    bits.push('The original creditor and the collector are both showing a balance for the same debt.');
  }
  if (findings.some((finding) => finding.id.includes('cross-'))) {
    bits.push('Two bureaus published different Metro 2 values for the same account.');
  }
  if (findings.some((finding) => finding.id.includes('bankruptcy'))) {
    bits.push('A discharged debt is still listed as money owed.');
  }
  if (findings.some((finding) => /ladder-|missing-cell|history-before|lates-after/.test(finding.id))) {
    bits.push('The payment history skips a step or is missing a month, so the profile is incomplete.');
  }
  if (findings.some((finding) => /current-but|status-vs/.test(finding.id))) {
    bits.push('The account status does not match the newest coded month on the grid.');
  }
  if (findings.some((finding) => /pastdue-over|zero-but|balance-over/.test(finding.id))) {
    bits.push('The balance and the past-due amount cannot both be right.');
  }
  if (findings.some((finding) => /closed-before|paid-after-close|paid-before-open/.test(finding.id))) {
    bits.push('The open, close, and payment dates are in an order that cannot happen on one account.');
  }
  return bits;
}

export function explainCoding(findings, extras = []) {
  const mailed = findings.filter((finding) => finding.mail);
  const review = reviewClaim(findings);
  if (mailed.length === 0) {
    return `Nothing to mail. ${review.reasons.join(' ')} The draft stays on this device for you to read. It is not legal advice.`;
  }
  const bits = themeBits(mailed);
  const lead = bits.length ? bits.join(' ') : 'The letter quotes the specific fields on the report that contradict each other.';
  const extra = [...extras, ...review.suppressed].filter(Boolean).join(' ');
  return `Why this letter: ${lead} ${extra} It argues the coding, not that a true late never happened. Check every date against the report before you mail it. This is a draft, not legal advice.`.replace(/\s+/g, ' ').trim();
}

export function explainBureau(file, bureau, findings) {
  const ids = new Set((file.tradelines ?? []).filter((tradeline) => tradeline.bureau === bureau).map((tradeline) => tradeline.id));
  return explainCoding(findings.filter((finding) => ids.has(finding.tradelineId)));
}

export function explainFurnisher(file, furnisher, findings) {
  const ids = new Set((file.tradelines ?? []).filter((tradeline) => tradeline.creditor === furnisher).map((tradeline) => tradeline.id));
  return explainCoding(findings.filter((finding) => ids.has(finding.tradelineId)));
}

export function explainMov(file, bureau, findings) {
  const ids = new Set((file.tradelines ?? []).filter((tradeline) => bureau === 'unknown' || tradeline.bureau === bureau).map((tradeline) => tradeline.id));
  const relevant = findings.filter((finding) => ids.has(finding.tradelineId));
  if (!relevant.some((finding) => finding.mail)) return explainCoding(relevant);
  return 'Why this letter: they already said verified, and the same coding break is still there. This follow-up does not repeat the first dispute. It asks who was contacted, what was sent, and what came back. Check it against the new report before you mail it. This is a draft, not legal advice.';
}

export function explainCfpb() {
  return 'Why this note: it is a short record for a complaint after a bureau says verified and the same break remains. It is not a new dispute, and it is not legal advice.';
}

export function explainPacket() {
  return 'Why this packet: it collects the same coding rebuttals for your records. Holds stay out. It is a draft, not legal advice.';
}
