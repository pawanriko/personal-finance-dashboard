import {
  ArrowsLeftRight,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bank,
  CaretLeft,
  CaretRight,
  ChartBar,
  ChartPieSlice,
  Check,
  Code,
  Coins,
  CreditCard,
  Gear,
  GithubLogo,
  LinkedinLogo,
  PiggyBank,
  SquaresFour,
  Target,
  X,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

/* One consistent icon set for the whole app (skill B6: Phosphor).
   Every icon renders at the same visual weight (regular weight,
   currentColor) so nav, stat cards, buttons and the footer all read
   as one family. Brand marks are the exception: GitHub and LinkedIn
   use their filled Phosphor logos. LeetCode has no Phosphor logo, so
   the Code mark stands in for it, as before. */

type IconProps = { size?: number };

function wrap(Icon: PhosphorIcon) {
  return function WrappedIcon({ size = 24 }: IconProps) {
    return <Icon size={size} />;
  };
}

function wrapFill(Icon: PhosphorIcon) {
  return function WrappedIcon({ size = 24 }: IconProps) {
    return <Icon size={size} weight="fill" />;
  };
}

export const IconDashboard = wrap(SquaresFour);
export const IconTransactions = wrap(ArrowsLeftRight);
export const IconBudgets = wrap(ChartPieSlice);
export const IconAccounts = wrap(Bank);
export const IconReports = wrap(ChartBar);
export const IconGoals = wrap(Target);
export const IconSettings = wrap(Gear);
export const IconArrowUp = wrap(ArrowUp);
export const IconArrowDown = wrap(ArrowDown);
export const IconArrowRight = wrap(ArrowRight);
export const IconChevronLeft = wrap(CaretLeft);
export const IconChevronRight = wrap(CaretRight);
export const IconClose = wrap(X);
export const IconCheck = wrap(Check);
export const IconBank = wrap(Bank);
export const IconSavings = wrap(PiggyBank);
export const IconCard = wrap(CreditCard);
export const IconCash = wrap(Coins);
export const IconGithub = wrapFill(GithubLogo);
export const IconLinkedin = wrapFill(LinkedinLogo);
export const IconCode = wrap(Code);
