import { FUEL_COLORS, FUEL_LABELS, VOLTAGE_BRACKETS } from '../constants';

/**
 * Legend rows for a page showing plants and lines: the fuels currently shown
 * and the voltage brackets present, in the page's own colours.
 */
export function powerLegend({ presentFuels, fuelsOff, presentKvs, theme }) {
  const fuels = [...(presentFuels || [])].filter(f => !fuelsOff?.has(f) && FUEL_COLORS[f])
    .map(f => ({ shape: 'circle', color: FUEL_COLORS[f], label: FUEL_LABELS?.[f] || f }));
  const lines = VOLTAGE_BRACKETS.filter(b => !presentKvs || presentKvs.has(b.key))
    .map(b => ({ shape: 'line', color: b.colors[theme] ?? b.colors.fog, label: b.label }));
  return [...fuels, ...lines];
}
