export function tradeline(id, bureau, extra = {}) {
  return {
    id,
    bureau,
    creditor: 'Sample Card',
    accountNumber: '****1000',
    accountType: 'Credit card',
    status: 'Pays as agreed',
    dateOpened: '2020-01-15',
    dateClosed: null,
    dateReported: '2026-10-15',
    dateOfLastPayment: null,
    dofd: null,
    chargeOffDate: null,
    balance: 0,
    pastDue: 0,
    highBalance: 1000,
    creditLimit: 2000,
    monthlyPayment: null,
    chargeOffAmount: null,
    paymentHistory: [],
    remarks: '',
    originalCreditor: '',
    isCollection: false,
    isChargeOff: false,
    dischargedBankruptcy: false,
    ...extra,
  };
}

export function report(tradelines, extra = {}) {
  return {
    consumerName: extra.consumerName ?? 'Practice File',
    reportDate: extra.reportDate ?? '2026-11-01',
    tradelines,
    inquiries: extra.inquiries ?? [],
    mailings: [],
    rawText: '',
  };
}

export const DATE_LINE = 'November 11, 2026';
