import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as USD currency.
 */
export function formatCurrency(value, decimals = 2) {
  if (value == null || isNaN(value)) return '$0.00';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(decimals)}`;
}

/**
 * Format a number with +/- sign and color class.
 */
export function formatPnL(value) {
  if (value == null || isNaN(value)) return { text: '$0.00', className: 'text-slate-400' };
  const formatted = formatCurrency(value);
  const prefix = value > 0 ? '+' : '';
  const className = value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-slate-400';
  return { text: `${prefix}${formatted}`, className };
}

/**
 * Format a percentage.
 */
export function formatPercent(value, decimals = 1) {
  if (value == null || isNaN(value)) return '0%';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a date string for display.
 */
export function formatDate(dateStr, options = {}) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...options,
  });
}

/**
 * Format a datetime string for display.
 */
export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}
