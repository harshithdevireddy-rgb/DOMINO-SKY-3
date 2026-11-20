import type { FlightStatus, NetworkStatus } from '@/types';

export const COLORS = {
  bg: '#080D18', surface: '#111827', elevated: '#182235', line: '#243049',
  ok: '#2dd4bf', warn: '#f59e0b', bad: '#ef4444', rec: '#22d3ee', mute: '#8a97b2', ink: '#e5eaf5', neutral: '#5b7a8c',
} as const;

export const STATUS_COLOR: Record<FlightStatus | 'recovered', string> = {
  on_time: COLORS.ok, delayed: COLORS.warn, severe: COLORS.bad, cancelled: COLORS.bad, recovered: COLORS.rec,
};
export const STATUS_LABEL: Record<FlightStatus | 'recovered', string> = {
  on_time: 'On time', delayed: 'Delayed', severe: 'Severely delayed', cancelled: 'Cancelled', recovered: 'Recovered',
};
export const NETWORK_STATUS_STYLE: Record<NetworkStatus, { label: string; color: string; text: string }> = {
  NORMAL: { label: 'NORMAL OPERATIONS', color: COLORS.ok, text: 'All flights operating to schedule.' },
  MINOR: { label: 'MINOR DISRUPTION', color: '#a3e635', text: 'Limited, contained delays.' },
  MAJOR: { label: 'MAJOR DISRUPTION', color: COLORS.warn, text: 'Significant delays, missed connections or crew pressure.' },
  CRITICAL: { label: 'CRITICAL NETWORK DISRUPTION', color: COLORS.bad, text: 'Widespread disruption across the network.' },
};
