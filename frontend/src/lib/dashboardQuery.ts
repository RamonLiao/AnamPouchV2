import type { ObjectId, SuiAddress } from '../types/contracts';
import {
  queryRecordCreatedByPatient,
  queryRevokedRecordIds,
  queryLatestSummary,
  fetchRecordAnchor,
  type SummaryRow,
} from '../api/queries';

export interface TimelineEntry {
  recordId: ObjectId;
  visitMs: bigint;
}

export interface DashboardData {
  recordCount: number;
  timeline: TimelineEntry[];
  latestSummary: SummaryRow | null;
}

/** Pure aggregation — no network. Sorts timeline ascending by visitMs. */
export function buildDashboard(
  anchors: TimelineEntry[],
  latestSummary: SummaryRow | null,
): DashboardData {
  const timeline = anchors.slice().sort((a, b) => (a.visitMs < b.visitMs ? -1 : a.visitMs > b.visitMs ? 1 : 0));
  return { recordCount: anchors.length, timeline, latestSummary };
}

/** Async wrapper: fetches chain data then delegates to buildDashboard. */
export async function loadDashboard(patient: SuiAddress): Promise<DashboardData> {
  const revoked = await queryRevokedRecordIds();
  const { records } = await queryRecordCreatedByPatient(patient);
  const active = records.filter((id) => !revoked.has(id));

  const anchors: TimelineEntry[] = [];
  for (const id of active) {
    const a = await fetchRecordAnchor(id);
    if (a) anchors.push({ recordId: id, visitMs: BigInt(a.visit_timestamp_ms) });
  }

  const latestSummary = await queryLatestSummary(patient, revoked);
  return buildDashboard(anchors, latestSummary);
}
