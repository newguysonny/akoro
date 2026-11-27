/** Accounts module pages (mgmt schema). */
import { useState, useEffect } from 'react';
import { Wallet, TrendingUp, TrendingDown, Landmark, Receipt } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet } from '../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';

const BASE = '/api/school/mgmt';
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

export function AccountsDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/accounts`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: naira(s.totalIncome), label: 'Total Income', icon: TrendingUp, ti: 'ti-trending-up', c: GREEN, to: '/mgmt/income' },
    { n: naira(s.totalExpense), label: 'Total Expenses', icon: TrendingDown, ti: 'ti-trending-down', c: RED, to: '/mgmt/expense' },
    { n: naira(s.netBalance), label: 'Net Balance', icon: Wallet, ti: 'ti-wallet', c: s.netBalance >= 0 ? GREEN : RED },
    { n: s.incomeEntries, label: 'Income Entries', icon: Receipt, ti: 'ti-receipt', c: BLUE, to: '/mgmt/income' },
    { n: s.expenseEntries, label: 'Expense Entries', icon: Receipt, ti: 'ti-receipt', c: PURPLE, to: '/mgmt/expense' },
    { n: s.bankAccounts, label: 'Bank Accounts', icon: Landmark, ti: 'ti-building-bank', c: C.brand, to: '/mgmt/bank-accounts' },
  ] : [];
  return (
    <PageLayout title="Accounts Dashboard" subtitle="Income, expenses and bank balances">
      <StatCards cards={cards} loading={!s} />
    </PageLayout>
  );
}

export function IncomePage() {
  return <ResourcePage title="Income" subtitle="Money received outside fee collection" resource="incomes"
    columns={[
      { key: 'head_name', label: 'Head' }, { key: 'source', label: 'Source' },
      { key: 'amount', label: 'Amount', render: (r) => <b style={{ color: GREEN }}>{naira(r.amount)}</b> },
      { key: 'reference', label: 'Reference' }, { key: 'received_on', label: 'Date' },
    ]}
    fields={[
      { key: 'head_id', label: 'Income Head', type: 'select', optionsFrom: { resource: 'income-heads' } },
      { key: 'amount', label: 'Amount (₦)', type: 'number', required: true },
      { key: 'source', label: 'Source' },
      { key: 'received_on', label: 'Date', type: 'date' },
      { key: 'reference', label: 'Reference' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'head_id', label: 'Head', optionsFrom: { resource: 'income-heads' } }]} createLabel="New Income" />;
}

export function ExpensePage() {
  return <ResourcePage title="Expense" subtitle="Money paid out" resource="expenses"
    columns={[
      { key: 'head_name', label: 'Head' }, { key: 'paid_to', label: 'Paid To' },
      { key: 'amount', label: 'Amount', render: (r) => <b style={{ color: RED }}>{naira(r.amount)}</b> },
      { key: 'reference', label: 'Reference' }, { key: 'spent_on', label: 'Date' },
    ]}
    fields={[
      { key: 'head_id', label: 'Expense Head', type: 'select', optionsFrom: { resource: 'expense-heads' } },
      { key: 'amount', label: 'Amount (₦)', type: 'number', required: true },
      { key: 'paid_to', label: 'Paid To' },
      { key: 'spent_on', label: 'Date', type: 'date' },
      { key: 'reference', label: 'Reference' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'head_id', label: 'Head', optionsFrom: { resource: 'expense-heads' } }]} createLabel="New Expense" />;
}

export function IncomeHeadsPage() {
  return <ResourcePage title="Income Heads" subtitle="Categories for income" resource="income-heads"
    columns={[{ key: 'name', label: 'Head' }]} fields={[{ key: 'name', label: 'Head Name', required: true }]} createLabel="New Head" />;
}

export function ExpenseHeadsPage() {
  return <ResourcePage title="Expense Heads" subtitle="Categories for expenses" resource="expense-heads"
    columns={[{ key: 'name', label: 'Head' }]} fields={[{ key: 'name', label: 'Head Name', required: true }]} createLabel="New Head" />;
}

export function BankAccountsPage() {
  return <ResourcePage title="Bank Accounts" subtitle="The school's bank accounts" resource="bank-accounts"
    columns={[
      { key: 'name', label: 'Account' }, { key: 'bank_name', label: 'Bank' },
      { key: 'account_no', label: 'Account No' }, { key: 'balance', label: 'Balance', render: (r) => <b>{naira(r.balance)}</b> },
    ]}
    fields={[
      { key: 'name', label: 'Account Name', required: true },
      { key: 'bank_name', label: 'Bank' },
      { key: 'account_no', label: 'Account No' },
      { key: 'balance', label: 'Balance (₦)', type: 'number' },
    ]} createLabel="New Account" />;
}
