/** Types mirroring the Django serializers (core/serializers.py).
 *  Money is always a 2-decimal string, never a float. */

export interface User {
  id: number;
  username: string;
  email: string;
  date_joined: string;
}

export interface Profile {
  username: string;
  email: string;
  default_currency: string;
}

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'cash';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  currency: string;
  opening_balance: string;
  balance: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type CategoryType = 'income' | 'expense';

export interface CategoryChild {
  id: number;
  name: string;
  type: CategoryType;
}

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  parent: number | null;
  children: CategoryChild[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: number;
  account: number;
  account_name: string;
  category: number | null;
  category_name: string | null;
  type: TransactionType;
  amount: string;
  date: string;
  merchant: string;
  notes: string;
  is_transfer: boolean;
  transfer: number | null;
  created_at: string;
  updated_at: string;
}

export interface Transfer {
  id: number;
  source_account: number;
  source_account_name: string;
  destination_account: number;
  destination_account_name: string;
  amount: string;
  date: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: number;
  account: number;
  category: number | null;
  type: TransactionType;
  amount: string;
  merchant: string;
  notes: string;
  frequency: Frequency;
  start_date: string;
  next_due: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type BudgetStatus = 'ok' | 'near' | 'over';

export interface Budget {
  id: number;
  category: number;
  category_name: string;
  month: string; // YYYY-MM-01
  limit: string;
  spent: string;
  remaining: string;
  percent_used: number;
  status: BudgetStatus;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: number;
  name: string;
  target_amount: string;
  target_date: string | null;
  account: number | null;
  account_name: string | null;
  current_amount: string;
  remaining_amount: string;
  progress_percent: number;
  created_at: string;
  updated_at: string;
}

export interface GoalContribution {
  id: number;
  goal: number;
  amount: string;
  date: string;
  note: string;
  created_at: string;
}

export interface CsvImportRow {
  row: number;
  data: Record<string, string>;
  parsed: Record<string, string>;
  errors: string[];
  is_duplicate: boolean;
  selected: boolean;
}

export interface CsvImport {
  id: number;
  file: string;
  file_name: string | null;
  account: number;
  status: 'preview' | 'imported' | 'failed';
  mapping: Record<string, string>;
  rows: CsvImportRow[];
  valid_count: number;
  error_count: number;
  duplicate_count: number;
  created_count: number;
  skipped_count: number;
  created_at: string;
  updated_at: string;
}

export interface SpendingByCategory {
  category: string;
  total: string;
}

export interface MonthlyPoint {
  month: string; // YYYY-MM-01
  income: string;
  expenses: string;
  net: string;
}

export interface PeriodTotals {
  income: string;
  expenses: string;
  net: string;
}

export interface DashboardBudget {
  budget_id: number;
  category: string;
  limit: string;
  spent: string;
  remaining: string;
  percent_used: number;
  status: BudgetStatus;
}

export interface DashboardSummary {
  period: { start: string; end: string };
  total_balances: Record<string, string>;
  income: string;
  expenses: string;
  net: string;
  previous_period: { start: string; end: string } & PeriodTotals;
  spending_by_category: SpendingByCategory[];
  monthly_series: MonthlyPoint[];
  recent_transactions: Transaction[];
  budgets: DashboardBudget[];
}

export interface ReportsSummary {
  period: { start: string; end: string };
  income: string;
  expenses: string;
  net: string;
  previous_period: { start: string; end: string } & PeriodTotals;
  spending_by_category: SpendingByCategory[];
  monthly_series: MonthlyPoint[];
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
