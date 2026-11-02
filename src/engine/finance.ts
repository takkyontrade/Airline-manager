// Bank loans and the balance sheet.
import { econ, loanRate, yearFrac } from '../data/economy';
import { nowYM, planeValue } from './fleet';
import type { GameState, Loan } from './types';
import { fail, formatYen, nextId, ok, withNews, type Result } from './util';

export const LOAN_TERMS = [3, 5, 10, 15] as const;

export function currentLoanRate(s: GameState): number {
  // weaker companies pay a risk premium
  const premium = s.reputation < 40 ? 0.015 : s.reputation < 55 ? 0.005 : 0;
  return loanRate(yearFrac(s.year, s.month)) + premium;
}

export const debt = (s: GameState) => s.loans.reduce((n, l) => n + l.balanceYen, 0);

export function fleetValue(s: GameState): number {
  return s.planes
    .filter((p) => p.status !== 'onOrder' && (!p.lease || p.lease.kind === 'finance'))
    .reduce((n, p) => n + planeValue(s, p), 0);
}

/** Average monthly profit over the last 12 months */
function recentProfit(s: GameState): number {
  const h = s.history.slice(-12);
  return h.length ? h.reduce((n, x) => n + x.profit, 0) / h.length : 0;
}

/** How much more the bank is willing to lend */
export function creditLimit(s: GameState): number {
  const base = 300_000_000 * econ.jpCpi(yearFrac(s.year, s.month));
  const collateral = fleetValue(s) * 0.7;
  const earnings = Math.max(0, recentProfit(s)) * 36;
  const limit = base + collateral + earnings;
  return Math.max(0, limit - debt(s));
}

export function monthlyPayment(principal: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  return r === 0 ? principal / n : (principal * r) / (1 - (1 + r) ** -n);
}

export function takeLoan(s: GameState, amount: number, years: number): Result {
  if (s.gameOver) return fail('ゲームオーバーです');
  amount = Math.round(amount);
  if (amount <= 0) return fail('借入額を入力してください');
  if (amount > creditLimit(s)) return fail(`銀行が貸してくれるのは${formatYen(creditLimit(s))}までです`);
  const rate = currentLoanRate(s);
  const [id, s2] = nextId(s, 'L');
  const loan: Loan = {
    id, principalYen: amount, balanceYen: amount, annualRate: rate,
    monthlyPaymentYen: monthlyPayment(amount, rate, years), startYM: nowYM(s), endYM: nowYM(s) + years * 12 - 1,
  };
  return ok(withNews({ ...s2, cash: s2.cash + amount, loans: [...s2.loans, loan] },
    `銀行から${formatYen(amount)}を借り入れました（${years}年、年利${(rate * 100).toFixed(1)}%）。`));
}

export function repayLoan(s: GameState, loanId: string): Result {
  const l = s.loans.find((x) => x.id === loanId);
  if (!l) return fail('借入が見つかりません');
  if (s.cash < l.balanceYen) return fail('一括返済する資金が足りません');
  return ok(withNews({ ...s, cash: s.cash - l.balanceYen, loans: s.loans.filter((x) => x.id !== loanId) },
    `借入金${formatYen(l.balanceYen)}を一括返済しました。`));
}

/** Monthly debt service: returns interest paid, principal paid and updated loans */
export function serviceLoans(loans: Loan[]): { interest: number; principal: number; loans: Loan[] } {
  let interest = 0;
  let principal = 0;
  const next: Loan[] = [];
  for (const l of loans) {
    const i = (l.balanceYen * l.annualRate) / 12;
    const p = Math.min(l.balanceYen, l.monthlyPaymentYen - i);
    interest += i;
    principal += p;
    const balance = l.balanceYen - p;
    if (balance > 1) next.push({ ...l, balanceYen: balance });
  }
  return { interest, principal, loans: next };
}
